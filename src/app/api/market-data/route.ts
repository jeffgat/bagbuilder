import { ASSETS, getAsset } from "@/lib/assets"
import { generateDemoCandles } from "@/lib/demo-data"
import { applyPriceAdjustments, detectSplitAdjustments } from "@/lib/price-adjustments"
import type { AssetSymbol, Candle, MarketDataResponse, PriceAdjustmentEvent } from "@/types/market"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DATABENTO_TIMESERIES_ENDPOINT = "https://hist.databento.com/v0/timeseries.get_range"
const DATABENTO_ADJUSTMENT_FACTORS_ENDPOINT = "https://hist.databento.com/v0/adjustment_factors.get_range"
const DATABENTO_DATASET_RANGE_ENDPOINT = "https://hist.databento.com/v0/metadata.get_dataset_range"
const DATABENTO_COST_ENDPOINT = "https://hist.databento.com/v0/metadata.get_cost"
const COINGECKO_MARKET_CHART_ENDPOINT = "https://api.coingecko.com/api/v3/coins"
const COINMETRICS_ASSET_METRICS_ENDPOINT = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
const COINMETRICS_ASSET_METRICS_CATALOG_ENDPOINT = "https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics"
const MAX_MONTHS = 240
const DEFAULT_DATASET_CANDIDATES = ["EQUS.MINI", "EQUS.SUMMARY", "XNAS.BASIC"] as const
const DEFAULT_COST_CAP_USD = 0
const DEFAULT_DATABENTO_PLAN = "standard"
const DAILY_SCHEMA = "ohlcv-1d"
const COINGECKO_PUBLIC_MAX_MONTHS = 12
const STANDARD_INCLUDED_DATASETS = new Set([
  "ARCX.PILLAR",
  "BATS.PITCH",
  "BATY.PITCH",
  "DBEQ.BASIC",
  "EDGA.PITCH",
  "EDGX.PITCH",
  "EQUS.MINI",
  "EQUS.SUMMARY",
  "XNAS.BASIC",
  "XNAS.ITCH",
  "XNYS.PILLAR",
])
const STANDARD_INCLUDED_L0_SCHEMAS = new Set(["ohlcv-1s", "ohlcv-1m", "ohlcv-1h", "ohlcv-1d"])
const SPLIT_REASON_CODES = new Set([61, 62])
const MAX_CANDLE_CACHE_ENTRIES = 64

type DataAccess = "included" | "cost-capped"

type CandidatePlan = {
  dataset: string
  schema: string
  start: string
  end: string
  availableStart: string
  availableEnd: string
  availableMonths: number
  estimatedCostUsd: number
  dataAccess: DataAccess
  candidateOrder: number
}

type AdjustmentResult = NonNullable<MarketDataResponse["adjustment"]>
type DatasetRange = {
  start?: string
  end?: string
  schema?: Record<string, { start?: string; end?: string }>
}

const datasetRangeCache = new Map<string, Promise<DatasetRange>>()
const costEstimateCache = new Map<string, Promise<number>>()
const candleCache = new Map<string, Promise<Candle[]>>()
const coinGeckoCache = new Map<string, Promise<Candle[]>>()
const coinMetricsCache = new Map<string, Promise<Candle[]>>()
const coinMetricsAvailabilityCache = new Map<string, Promise<NonNullable<MarketDataResponse["availability"]> | null>>()

function clampMonths(value: string | null) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 36
  }

  return Math.min(MAX_MONTHS, Math.max(1, Math.round(parsed)))
}

function isAssetSymbol(value: string): value is AssetSymbol {
  return ASSETS.some(
    (asset) => asset.symbol.toUpperCase() === value || asset.dataSymbol.toUpperCase() === value
  )
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseCostCap(value: string | undefined) {
  if (!value) {
    return DEFAULT_COST_CAP_USD
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_COST_CAP_USD
}

function parseDatabentoPlan(value: string | undefined) {
  return value?.trim().toLowerCase() || DEFAULT_DATABENTO_PLAN
}

function parseBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true"
}

function getDataAccess({
  dataset,
  planName,
  schema,
}: {
  dataset: string
  planName: string
  schema: string
}): DataAccess {
  return planName === "standard" &&
    STANDARD_INCLUDED_DATASETS.has(dataset) &&
    STANDARD_INCLUDED_L0_SCHEMAS.has(schema)
    ? "included"
    : "cost-capped"
}

function canUsePlan(plan: CandidatePlan, costCapUsd: number) {
  return plan.dataAccess === "included" || plan.estimatedCostUsd <= costCapUsd
}

function billingDescription(plan: CandidatePlan) {
  return plan.dataAccess === "included" ? "standard plan l0 included" : "usage estimate within cost cap"
}

function uniqueDatasets(datasets: readonly string[]) {
  return Array.from(new Set(datasets))
}

function getDatasetCandidates(asset: { dataset: string; datasetCandidates?: string[] }) {
  return uniqueDatasets([...(asset.datasetCandidates ?? []), asset.dataset, ...DEFAULT_DATASET_CANDIDATES])
}

function sortByOldestPlan(a: CandidatePlan, b: CandidatePlan) {
  return (
    a.availableStart.localeCompare(b.availableStart) ||
    a.start.localeCompare(b.start) ||
    a.candidateOrder - b.candidateOrder
  )
}

function trimCandleCache() {
  while (candleCache.size > MAX_CANDLE_CACHE_ENTRIES) {
    const oldestKey = candleCache.keys().next().value

    if (!oldestKey) {
      break
    }

    candleCache.delete(oldestKey)
  }
}

function formatUsd(value: number) {
  if (value > 0 && value < 0.01) {
    return "less than $0.01"
  }

  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  })
}

function authHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
}

function parseDatabentoDetail(text: string, fallback: string) {
  try {
    const parsed = JSON.parse(text) as {
      detail?: { message?: string } | string
      error?: { status?: { error_message?: string } } | string
      message?: string
    }

    if (typeof parsed.detail === "object") {
      return parsed.detail?.message ?? parsed.message ?? fallback
    }

    if (parsed.detail) {
      return parsed.detail
    }

    if (typeof parsed.error === "object") {
      return parsed.error.status?.error_message ?? parsed.message ?? fallback
    }

    return parsed.error ?? parsed.message ?? fallback
  } catch {
    return text || fallback
  }
}

function monthsBetween(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00.000Z`)
  const endDate = new Date(`${end}T00:00:00.000Z`)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0
  }

  const days = Math.max(0, (endDate.getTime() - startDate.getTime()) / 86_400_000)

  return Math.max(1, Math.round(days / 30.4375))
}

function getDataRange(candles: Candle[], requestedMonths: number) {
  const firstCandle = candles.at(0)
  const lastCandle = candles.at(-1)
  const actualMonths = firstCandle && lastCandle ? monthsBetween(firstCandle.time, lastCandle.time) : 0

  return {
    requestedMonths,
    actualMonths,
    start: firstCandle?.time ?? null,
    end: lastCandle?.time ?? null,
    isLimited: actualMonths > 0 && actualMonths < requestedMonths,
  }
}

function getAvailability(plan: CandidatePlan | null) {
  return {
    months: plan?.availableMonths ?? MAX_MONTHS,
    start: plan?.availableStart.slice(0, 10) ?? null,
    end: plan?.availableEnd.slice(0, 10) ?? null,
  }
}

function getCandleAvailability(candles: Candle[]) {
  const firstCandle = candles.at(0)
  const lastCandle = candles.at(-1)

  return {
    months: firstCandle && lastCandle ? monthsBetween(firstCandle.time, lastCandle.time) : MAX_MONTHS,
    start: firstCandle?.time ?? null,
    end: lastCandle?.time ?? null,
  }
}

function getLatestLikelyAvailableEnd() {
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)

  const day = end.getUTCDay()
  if (day === 0) {
    end.setUTCDate(end.getUTCDate() - 1)
  }
  if (day === 1) {
    end.setUTCDate(end.getUTCDate() - 2)
  }

  return end
}

function getRequestedDateRange(months: number) {
  const end = getLatestLikelyAvailableEnd()
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()))

  return {
    start: `${dateOnly(start)}T00:00`,
    end: `${dateOnly(end)}T00:00`,
  }
}

function latestStartDate(requestedStart: string, availableStart: string) {
  return requestedStart.slice(0, 10).localeCompare(availableStart.slice(0, 10)) > 0 ? requestedStart : `${availableStart.slice(0, 10)}T00:00`
}

function earliestEndDate(requestedEnd: string, availableEnd: string) {
  return requestedEnd.slice(0, 10).localeCompare(availableEnd.slice(0, 10)) < 0 ? requestedEnd : `${availableEnd.slice(0, 10)}T00:00`
}

function normalizePrice(value: unknown) {
  if (typeof value === "string") {
    return Number(value)
  }

  if (typeof value === "number") {
    return Math.abs(value) > 1_000_000 ? value / 1_000_000_000 : value
  }

  return Number.NaN
}

function normalizeRecord(record: Record<string, unknown>): Candle | null {
  const header = record.hd && typeof record.hd === "object" ? (record.hd as Record<string, unknown>) : undefined
  const timestamp = record.ts_event ?? header?.ts_event ?? record.ts_recv
  const time = typeof timestamp === "string" ? timestamp.slice(0, 10) : null
  const open = normalizePrice(record.open)
  const high = normalizePrice(record.high)
  const low = normalizePrice(record.low)
  const close = normalizePrice(record.close)

  if (!time || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number(record.volume ?? 0),
  }
}

function parseDatabentoJsonl(text: string) {
  const candlesByDate = new Map<string, Candle>()

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const record = JSON.parse(trimmed) as Record<string, unknown>
    const candle = normalizeRecord(record)
    if (candle) {
      candlesByDate.set(candle.time, candle)
    }
  }

  return Array.from(candlesByDate.values()).sort((a, b) => a.time.localeCompare(b.time))
}

type CoinGeckoMarketChart = {
  prices?: Array<[number, number]>
  total_volumes?: Array<[number, number]>
}

type CoinMetricsAssetMetrics = {
  data?: Array<{
    asset?: string
    time?: string
    PriceUSD?: string
  }>
  next_page_url?: string
}

type CoinMetricsAssetMetricCatalog = {
  data?: Array<{
    asset?: string
    metrics?: Array<{
      metric?: string
      frequencies?: Array<{
        frequency?: string
        min_time?: string
        max_time?: string
      }>
    }>
  }>
}

function getCryptoDateRange(months: number) {
  const end = new Date()
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()))

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  }
}

function getCryptoDateRangeLabels(months: number) {
  const end = new Date()
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()))

  return {
    start: dateOnly(start),
    end: dateOnly(end),
  }
}

function parseCoinMetricsAssetMetrics(payload: CoinMetricsAssetMetrics) {
  return (payload.data ?? [])
    .map((record): Candle | null => {
      const price = Number(record.PriceUSD)
      const time = record.time?.slice(0, 10)

      if (!time || !Number.isFinite(price) || price <= 0) {
        return null
      }

      return {
        time,
        open: Number(price.toFixed(8)),
        high: Number(price.toFixed(8)),
        low: Number(price.toFixed(8)),
        close: Number(price.toFixed(8)),
        volume: 0,
      }
    })
    .filter((candle): candle is Candle => Boolean(candle))
}

function parseCoinMetricsAvailability(payload: CoinMetricsAssetMetricCatalog) {
  const priceFrequency = payload.data
    ?.flatMap((asset) => asset.metrics ?? [])
    .find((metric) => metric.metric === "PriceUSD")
    ?.frequencies?.find((frequency) => frequency.frequency === "1d")

  if (!priceFrequency?.min_time || !priceFrequency.max_time) {
    return null
  }

  const start = priceFrequency.min_time.slice(0, 10)
  const end = priceFrequency.max_time.slice(0, 10)

  return {
    months: monthsBetween(start, end),
    start,
    end,
  }
}

async function fetchCoinMetricsAvailability(coinMetricsId: string) {
  const url = new URL(COINMETRICS_ASSET_METRICS_CATALOG_ENDPOINT)
  url.searchParams.set("assets", coinMetricsId)
  url.searchParams.set("metrics", "PriceUSD")

  const response = await fetch(url, {
    next: { revalidate: 3600 },
  })
  const text = await response.text()

  if (!response.ok) {
    const fallback = `Coin Metrics ${response.status}: unable to load crypto availability.`
    const detail = parseDatabentoDetail(text, fallback)

    throw new Error(typeof detail === "string" ? detail : fallback)
  }

  return parseCoinMetricsAvailability(JSON.parse(text) as CoinMetricsAssetMetricCatalog)
}

function getCachedCoinMetricsAvailability(coinMetricsId: string) {
  const cachedAvailability = coinMetricsAvailabilityCache.get(coinMetricsId)

  if (cachedAvailability) {
    return cachedAvailability
  }

  const availabilityPromise = fetchCoinMetricsAvailability(coinMetricsId).catch((error) => {
    coinMetricsAvailabilityCache.delete(coinMetricsId)
    throw error
  })

  coinMetricsAvailabilityCache.set(coinMetricsId, availabilityPromise)

  return availabilityPromise
}

async function fetchCoinMetricsCandles({
  coinMetricsId,
  months,
}: {
  coinMetricsId: string
  months: number
}) {
  const { start, end } = getCryptoDateRangeLabels(months)
  const candles: Candle[] = []
  let url: URL | null = new URL(COINMETRICS_ASSET_METRICS_ENDPOINT)
  url.searchParams.set("assets", coinMetricsId)
  url.searchParams.set("metrics", "PriceUSD")
  url.searchParams.set("frequency", "1d")
  url.searchParams.set("start_time", start)
  url.searchParams.set("end_time", end)
  url.searchParams.set("page_size", "10000")

  while (url) {
    const response = await fetch(url, {
      next: { revalidate: 300 },
    })
    const text = await response.text()

    if (!response.ok) {
      const fallback = `Coin Metrics ${response.status}: unable to load crypto market data.`
      const detail = parseDatabentoDetail(text, fallback)

      throw new Error(typeof detail === "string" ? detail : fallback)
    }

    const payload = JSON.parse(text) as CoinMetricsAssetMetrics
    candles.push(...parseCoinMetricsAssetMetrics(payload))
    url = payload.next_page_url ? new URL(payload.next_page_url) : null
  }

  return candles.sort((a, b) => a.time.localeCompare(b.time))
}

function getCachedCoinMetricsCandles({
  coinMetricsId,
  months,
}: {
  coinMetricsId: string
  months: number
}) {
  const cacheKey = `${coinMetricsId}:${months}`
  const cachedCandles = coinMetricsCache.get(cacheKey)

  if (cachedCandles) {
    return cachedCandles
  }

  const candlesPromise = fetchCoinMetricsCandles({ coinMetricsId, months }).catch((error) => {
    coinMetricsCache.delete(cacheKey)
    throw error
  })

  coinMetricsCache.set(cacheKey, candlesPromise)

  return candlesPromise
}

function parseCoinGeckoMarketChart(payload: CoinGeckoMarketChart) {
  const volumesByDate = new Map<string, number>()

  for (const [timestamp, volume] of payload.total_volumes ?? []) {
    const date = new Date(timestamp).toISOString().slice(0, 10)
    volumesByDate.set(date, Math.max(volumesByDate.get(date) ?? 0, Number(volume) || 0))
  }

  const candlesByDate = new Map<string, Candle>()

  for (const [timestamp, price] of payload.prices ?? []) {
    if (!Number.isFinite(price) || price <= 0) {
      continue
    }

    const time = new Date(timestamp).toISOString().slice(0, 10)
    const existing = candlesByDate.get(time)

    if (!existing) {
      candlesByDate.set(time, {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volumesByDate.get(time) ?? 0,
      })
      continue
    }

    candlesByDate.set(time, {
      ...existing,
      high: Math.max(existing.high, price),
      low: Math.min(existing.low, price),
      close: price,
      volume: volumesByDate.get(time) ?? existing.volume,
    })
  }

  return Array.from(candlesByDate.values())
    .map((candle) => ({
      ...candle,
      open: Number(candle.open.toFixed(8)),
      high: Number(candle.high.toFixed(8)),
      low: Number(candle.low.toFixed(8)),
      close: Number(candle.close.toFixed(8)),
      volume: Math.round(candle.volume),
    }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

async function fetchCoinGeckoCandles({
  coinGeckoId,
  months,
}: {
  coinGeckoId: string
  months: number
}) {
  const { from, to } = getCryptoDateRange(months)
  const url = new URL(`${COINGECKO_MARKET_CHART_ENDPOINT}/${coinGeckoId}/market_chart/range`)
  url.searchParams.set("vs_currency", "usd")
  url.searchParams.set("from", String(from))
  url.searchParams.set("to", String(to))

  const headers: HeadersInit = {}
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY
  }

  const response = await fetch(url, {
    headers,
    next: { revalidate: 300 },
  })
  const text = await response.text()

  if (!response.ok) {
    const fallback = `CoinGecko ${response.status}: unable to load crypto market data.`
    const detail = parseDatabentoDetail(text, fallback)

    throw new Error(typeof detail === "string" ? detail : fallback)
  }

  return parseCoinGeckoMarketChart(JSON.parse(text) as CoinGeckoMarketChart)
}

function getCachedCoinGeckoCandles({
  coinGeckoId,
  months,
}: {
  coinGeckoId: string
  months: number
}) {
  const cacheKey = `${coinGeckoId}:${months}`
  const cachedCandles = coinGeckoCache.get(cacheKey)

  if (cachedCandles) {
    return cachedCandles
  }

  const candlesPromise = fetchCoinGeckoCandles({ coinGeckoId, months }).catch((error) => {
    coinGeckoCache.delete(cacheKey)
    throw error
  })

  coinGeckoCache.set(cacheKey, candlesPromise)

  return candlesPromise
}

async function getCoinGeckoMarketData({
  asset,
  months,
  symbol,
}: {
  asset: ReturnType<typeof getAsset>
  months: number
  symbol: AssetSymbol
}): Promise<MarketDataResponse> {
  if (!asset.coinGeckoId) {
    throw new Error("selected crypto asset is missing a coingecko id.")
  }

  const fetchMonths = process.env.COINGECKO_API_KEY ? months : Math.min(months, COINGECKO_PUBLIC_MAX_MONTHS)
  const candles = await getCachedCoinGeckoCandles({
    coinGeckoId: asset.coinGeckoId,
    months: fetchMonths,
  })
  const adjustment = buildAdjustmentResult([])
  const publicLimitNote = process.env.COINGECKO_API_KEY
    ? ""
    : " free public coingecko history is limited to the past 365 days; set COINGECKO_API_KEY for deeper plan-supported history."

  return {
    symbol,
    label: asset.label,
    name: asset.name,
    dataSymbol: asset.dataSymbol,
    dataset: asset.dataset,
    schema: asset.schema,
    source: "coingecko",
    note: `${marketDataNote(asset.note, adjustment)}${publicLimitNote}`,
    estimatedCostUsd: null,
    costCapUsd: 0,
    billing: {
      access: "free",
      plan: "coingecko demo",
      description: "public crypto market data",
    },
    availability: getCandleAvailability(candles),
    adjustment,
    range: getDataRange(candles, months),
    candles,
  }
}

async function getCoinMetricsMarketData({
  asset,
  months,
  symbol,
}: {
  asset: ReturnType<typeof getAsset>
  months: number
  symbol: AssetSymbol
}): Promise<MarketDataResponse> {
  if (!asset.coinMetricsId) {
    throw new Error("selected crypto asset is missing a coin metrics id.")
  }

  const candles = await getCachedCoinMetricsCandles({
    coinMetricsId: asset.coinMetricsId,
    months,
  })
  const availability = (await getCachedCoinMetricsAvailability(asset.coinMetricsId)) ?? getCandleAvailability(candles)
  const adjustment = buildAdjustmentResult([])

  return {
    symbol,
    label: asset.label,
    name: asset.name,
    dataSymbol: asset.dataSymbol,
    dataset: "coinmetrics-community",
    schema: "PriceUSD-1d",
    source: "coinmetrics",
    note: `${marketDataNote(asset.note, adjustment)} coin metrics community provides daily reference prices, so open/high/low are represented with the daily PriceUSD value.`,
    estimatedCostUsd: null,
    costCapUsd: 0,
    billing: {
      access: "free",
      plan: "coin metrics community",
      description: "free daily crypto reference price",
    },
    availability,
    adjustment,
    range: getDataRange(candles, months),
    candles,
  }
}

function getCryptoMarketData({
  asset,
  months,
  symbol,
}: {
  asset: ReturnType<typeof getAsset>
  months: number
  symbol: AssetSymbol
}) {
  if (asset.coinMetricsId) {
    return getCoinMetricsMarketData({ asset, months, symbol })
  }

  return getCoinGeckoMarketData({ asset, months, symbol })
}

function getAdjustmentDate(record: Record<string, unknown>) {
  const value = record.ex_date ?? record.date

  return typeof value === "string" ? value.slice(0, 10) : null
}

function isSplitAdjustment(record: Record<string, unknown>) {
  const reason = Number(record.reason)
  const event = String(record.event ?? "").toUpperCase()
  const detail = String(record.detail ?? "").toLowerCase()

  return (
    SPLIT_REASON_CODES.has(reason) ||
    event.includes("SPLT") ||
    detail.includes("split") ||
    detail.includes("subdivision") ||
    detail.includes("consolidation")
  )
}

function normalizeAdjustmentRecord(record: Record<string, unknown>): PriceAdjustmentEvent | null {
  const date = getAdjustmentDate(record)
  const factor = Number(record.factor)
  const status = String(record.status ?? "A").toUpperCase()
  const option = Number(record.option ?? 1)

  if (
    !date ||
    !Number.isFinite(factor) ||
    factor <= 0 ||
    status !== "A" ||
    (Number.isFinite(option) && option !== 1) ||
    !isSplitAdjustment(record)
  ) {
    return null
  }

  return {
    date,
    factor,
    source: "databento-reference",
    description: String(record.detail ?? "split adjustment factor from databento reference data").toLowerCase(),
  }
}

function parseDatabentoAdjustmentJsonl(text: string) {
  const eventsByDate = new Map<string, PriceAdjustmentEvent>()

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const record = JSON.parse(trimmed) as Record<string, unknown>
    const event = normalizeAdjustmentRecord(record)
    if (event) {
      eventsByDate.set(`${event.date}-${event.factor}`, event)
    }
  }

  return Array.from(eventsByDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function buildAdjustmentResult(events: PriceAdjustmentEvent[]): AdjustmentResult {
  return {
    price: events.length ? "split-adjusted" : "raw",
    source: events.at(0)?.source ?? "none",
    events,
  }
}

function splitAdjustmentNote(adjustment: AdjustmentResult) {
  if (adjustment.events.length === 0) {
    return "prices are raw ohlcv and price-only; dividends, taxes, fees, and split adjustment factors are not included."
  }

  const source =
    adjustment.source === "databento-reference"
      ? "databento reference split factors"
      : "detected raw price gaps"

  return `prices are split-adjusted using ${source}; dividends, taxes, and fees are not included.`
}

function marketDataNote(assetNote: string | undefined, adjustment: AdjustmentResult) {
  const adjustmentNote = splitAdjustmentNote(adjustment)

  return assetNote ? `${assetNote} ${adjustmentNote}` : adjustmentNote
}

async function fetchDatabentoCandles({
  dataSymbol,
  plan,
  apiKey,
}: {
  dataSymbol: string
  plan: CandidatePlan
  apiKey: string
}) {
  const body = new URLSearchParams({
    dataset: plan.dataset,
    symbols: dataSymbol,
    schema: plan.schema,
    start: plan.start,
    end: plan.end,
    encoding: "json",
    compression: "none",
    pretty_px: "true",
    pretty_ts: "true",
    map_symbols: "true",
    stype_in: "raw_symbol",
    stype_out: "instrument_id",
  })

  const response = await fetch(DATABENTO_TIMESERIES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  })

  const text = await response.text()

  if (!response.ok) {
    const detail = parseDatabentoDetail(text, response.statusText)

    throw new Error(`Databento ${response.status}: ${detail}`)
  }

  return parseDatabentoJsonl(text)
}

function getCachedDatabentoCandles({
  dataSymbol,
  plan,
  apiKey,
}: {
  dataSymbol: string
  plan: CandidatePlan
  apiKey: string
}) {
  const cacheKey = `${apiKey}:${dataSymbol}:${plan.dataset}:${plan.schema}:${plan.start}:${plan.end}`
  const cachedCandles = candleCache.get(cacheKey)

  if (cachedCandles) {
    return cachedCandles
  }

  const candlesPromise = fetchDatabentoCandles({
    dataSymbol,
    plan,
    apiKey,
  }).catch((error) => {
    candleCache.delete(cacheKey)
    throw error
  })

  candleCache.set(cacheKey, candlesPromise)
  trimCandleCache()

  return candlesPromise
}

async function fetchDatabentoSplitAdjustments({
  apiKey,
  dataSymbol,
  start,
  end,
}: {
  apiKey: string
  dataSymbol: string
  start: string
  end: string
}) {
  const body = new URLSearchParams({
    symbols: dataSymbol,
    stype_in: "raw_symbol",
    start: start.slice(0, 10),
    end: end.slice(0, 10),
    countries: "US",
    security_types: "EQS",
    encoding: "json",
  })

  const response = await fetch(DATABENTO_ADJUSTMENT_FACTORS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseDatabentoDetail(text, response.statusText))
  }

  return parseDatabentoAdjustmentJsonl(text)
}

async function getSplitAdjustmentEvents({
  apiKey,
  allowReferenceAdjustments,
  dataSymbol,
  candles,
  plan,
}: {
  apiKey: string
  allowReferenceAdjustments: boolean
  dataSymbol: string
  candles: Candle[]
  plan: CandidatePlan
}) {
  if (allowReferenceAdjustments) {
    try {
      const referenceEvents = await fetchDatabentoSplitAdjustments({
        apiKey,
        dataSymbol,
        start: plan.start,
        end: plan.end,
      })

      if (referenceEvents.length > 0) {
        return referenceEvents
      }
    } catch {
      // fall through to local price-gap detection when reference factors are unavailable.
    }
  }

  return detectSplitAdjustments(candles)
}

async function fetchDatasetRange(apiKey: string, dataset: string) {
  const url = new URL(DATABENTO_DATASET_RANGE_ENDPOINT)
  url.searchParams.set("dataset", dataset)

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(apiKey),
    },
    cache: "no-store",
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseDatabentoDetail(text, response.statusText))
  }

  return JSON.parse(text) as DatasetRange
}

function getCachedDatasetRange(apiKey: string, dataset: string) {
  const cacheKey = `${apiKey}:${dataset}`
  const cachedRange = datasetRangeCache.get(cacheKey)

  if (cachedRange) {
    return cachedRange
  }

  const rangePromise = fetchDatasetRange(apiKey, dataset).catch((error) => {
    datasetRangeCache.delete(cacheKey)
    throw error
  })

  datasetRangeCache.set(cacheKey, rangePromise)

  return rangePromise
}

async function fetchCostEstimate({
  apiKey,
  dataSymbol,
  dataset,
  schema,
  start,
  end,
}: {
  apiKey: string
  dataSymbol: string
  dataset: string
  schema: string
  start: string
  end: string
}) {
  const url = new URL(DATABENTO_COST_ENDPOINT)
  url.searchParams.set("dataset", dataset)
  url.searchParams.set("symbols", dataSymbol)
  url.searchParams.set("schema", schema)
  url.searchParams.set("start", start)
  url.searchParams.set("end", end)
  url.searchParams.set("stype_in", "raw_symbol")

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(apiKey),
    },
    cache: "no-store",
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseDatabentoDetail(text, response.statusText))
  }

  const parsed = JSON.parse(text) as unknown
  const cost = typeof parsed === "number" ? parsed : Number(parsed)

  if (!Number.isFinite(cost)) {
    throw new Error("Databento returned an invalid cost estimate.")
  }

  return cost
}

function getCachedCostEstimate({
  apiKey,
  dataSymbol,
  dataset,
  schema,
  start,
  end,
}: {
  apiKey: string
  dataSymbol: string
  dataset: string
  schema: string
  start: string
  end: string
}) {
  const cacheKey = `${apiKey}:${dataSymbol}:${dataset}:${schema}:${start}:${end}`
  const cachedCost = costEstimateCache.get(cacheKey)

  if (cachedCost) {
    return cachedCost
  }

  const costPromise = fetchCostEstimate({
    apiKey,
    dataSymbol,
    dataset,
    schema,
    start,
    end,
  }).catch((error) => {
    costEstimateCache.delete(cacheKey)
    throw error
  })

  costEstimateCache.set(cacheKey, costPromise)

  return costPromise
}

async function getCandidatePlan({
  apiKey,
  candidateOrder,
  dataSymbol,
  dataset,
  months,
  planName,
}: {
  apiKey: string
  candidateOrder: number
  dataSymbol: string
  dataset: string
  months: number
  planName: string
}): Promise<CandidatePlan | null> {
  const requested = getRequestedDateRange(months)
  const datasetRange = await getCachedDatasetRange(apiKey, dataset)
  const schemaRange = datasetRange.schema?.[DAILY_SCHEMA]
  const availableStart = schemaRange?.start ?? datasetRange.start
  const availableEnd = schemaRange?.end ?? datasetRange.end

  if (!availableStart || !availableEnd) {
    return null
  }

  const start = latestStartDate(requested.start, availableStart)
  const end = earliestEndDate(requested.end, availableEnd)
  const availableEndForRequest = earliestEndDate(requested.end, availableEnd)

  if (start.slice(0, 10).localeCompare(end.slice(0, 10)) >= 0) {
    return null
  }

  const estimatedCostUsd = await getCachedCostEstimate({
    apiKey,
    dataSymbol,
    dataset,
    schema: DAILY_SCHEMA,
    start,
    end,
  })

  return {
    dataset,
    schema: DAILY_SCHEMA,
    start,
    end,
    availableStart,
    availableEnd: availableEndForRequest,
    availableMonths: monthsBetween(availableStart.slice(0, 10), availableEndForRequest.slice(0, 10)),
    estimatedCostUsd,
    dataAccess: getDataAccess({ dataset, planName, schema: DAILY_SCHEMA }),
    candidateOrder,
  }
}

async function getCandidatePlans({
  apiKey,
  dataSymbol,
  datasets,
  months,
  planName,
}: {
  apiKey: string
  dataSymbol: string
  datasets: readonly string[]
  months: number
  planName: string
}) {
  const plans = await Promise.all(
    datasets.map(async (dataset, candidateOrder) => {
      try {
        return await getCandidatePlan({
          apiKey,
          candidateOrder,
          dataSymbol,
          dataset,
          months,
          planName,
        })
      } catch {
        return null
      }
    })
  )

  return plans.filter((plan): plan is CandidatePlan => Boolean(plan)).sort(sortByOldestPlan)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const requestedSymbol = (searchParams.get("symbol") ?? "SPY").toUpperCase()
  const asset = getAsset(isAssetSymbol(requestedSymbol) ? requestedSymbol : "SPY")
  const symbol = asset.symbol
  const months = clampMonths(searchParams.get("months"))
  const apiKey = process.env.DATABENTO_API_KEY
  const costCapUsd = parseCostCap(process.env.DATABENTO_MAX_COST_USD)
  const planName = parseDatabentoPlan(process.env.DATABENTO_PLAN)
  const allowReferenceAdjustments = parseBoolean(process.env.DATABENTO_ENABLE_REFERENCE_ADJUSTMENTS)
  const datasetCandidates = getDatasetCandidates(asset)

  if (asset.kind === "crypto") {
    try {
      return Response.json(await getCryptoMarketData({ asset, months, symbol }))
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "unable to load crypto market data.",
        },
        { status: 502 }
      )
    }
  }

  if (!apiKey) {
    const candles = generateDemoCandles(symbol, months)
    const adjustment = buildAdjustmentResult([])

    return Response.json({
      symbol,
      label: asset.label,
      name: asset.name,
      dataSymbol: asset.dataSymbol,
      dataset: asset.dataset,
      schema: asset.schema,
      source: "demo",
      note: `demo data is showing because DATABENTO_API_KEY is not set in .env.local. ${splitAdjustmentNote(adjustment)}`,
      estimatedCostUsd: null,
      costCapUsd,
      billing: {
        access: "demo",
        plan: planName,
        description: "not using databento",
      },
      availability: getAvailability(null),
      adjustment,
      range: getDataRange(candles, months),
      candles,
    })
  }

  try {
    const candidatePlans = await getCandidatePlans({
      apiKey,
      dataSymbol: asset.dataSymbol,
      datasets: datasetCandidates,
      months,
      planName,
    })
    const oldestCandidate = candidatePlans[0] ?? null
    const plan = candidatePlans.find((candidatePlan) => canUsePlan(candidatePlan, costCapUsd)) ?? null

    if (!plan) {
      const effectiveMonths = Math.min(months, oldestCandidate?.availableMonths ?? months)
      const candles = generateDemoCandles(symbol, effectiveMonths)
      const adjustment = buildAdjustmentResult([])
      const blockedCost =
        typeof oldestCandidate?.estimatedCostUsd === "number"
          ? ` oldest available source was estimated at ${formatUsd(oldestCandidate.estimatedCostUsd)}.`
          : ""

      return Response.json({
        symbol,
        label: asset.label,
        name: asset.name,
        dataSymbol: asset.dataSymbol,
        dataset: oldestCandidate?.dataset ?? asset.dataset,
        schema: oldestCandidate?.schema ?? asset.schema,
        source: "demo",
        note: `demo data is showing because no databento daily source was estimated at or below the $${costCapUsd.toFixed(2)} cost cap.${blockedCost} ${splitAdjustmentNote(adjustment)}`,
        estimatedCostUsd: null,
        costCapUsd,
        billing: {
          access: "demo",
          plan: planName,
          description: "not using databento",
        },
        availability: getAvailability(oldestCandidate),
        adjustment,
        range: getDataRange(candles, months),
        candles,
      })
    }

    const rawCandles = await getCachedDatabentoCandles({
      dataSymbol: asset.dataSymbol,
      plan,
      apiKey,
    })
    const adjustmentEvents = await getSplitAdjustmentEvents({
      apiKey,
      allowReferenceAdjustments,
      dataSymbol: asset.dataSymbol,
      candles: rawCandles,
      plan,
    })
    const candles = applyPriceAdjustments(rawCandles, adjustmentEvents)
    const adjustment = buildAdjustmentResult(adjustmentEvents)

    return Response.json({
      symbol,
      label: asset.label,
      name: asset.name,
      dataSymbol: asset.dataSymbol,
      dataset: plan.dataset,
      schema: plan.schema,
      source: "databento",
      note: marketDataNote(asset.note, adjustment),
      estimatedCostUsd: plan.estimatedCostUsd,
      costCapUsd,
      billing: {
        access: plan.dataAccess,
        plan: planName,
        description: billingDescription(plan),
      },
      availability: getAvailability(plan),
      adjustment,
      range: getDataRange(candles, months),
      candles,
    })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to load market data.",
      },
      { status: 502 }
    )
  }
}
