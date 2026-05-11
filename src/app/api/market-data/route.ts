import { ASSETS, getAsset } from "@/lib/assets"
import { generateDemoCandles } from "@/lib/demo-data"
import type { AssetSymbol, Candle } from "@/types/market"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DATABENTO_ENDPOINT = "https://hist.databento.com/v0/timeseries.get_range"
const MAX_MONTHS = 240
const DATASET_AVAILABLE_START: Record<string, string> = {
  "EQUS.MINI": "2023-03-28",
  "EQUS.SUMMARY": "2024-07-01",
}

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

function getDateRange(months: number, dataset: string) {
  const end = getLatestLikelyAvailableEnd()
  let start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()))
  const availableStart = DATASET_AVAILABLE_START[dataset]

  if (availableStart) {
    const minimumStart = new Date(`${availableStart}T00:00:00.000Z`)
    if (start < minimumStart) {
      start = minimumStart
    }
  }

  return {
    start: `${dateOnly(start)}T00:00`,
    end: `${dateOnly(end)}T00:00`,
  }
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

async function fetchDatabentoCandles({
  dataSymbol,
  dataset,
  schema,
  months,
  apiKey,
}: {
  dataSymbol: string
  dataset: string
  schema: string
  months: number
  apiKey: string
}) {
  const { start, end } = getDateRange(months, dataset)
  const body = new URLSearchParams({
    dataset,
    symbols: dataSymbol,
    schema,
    start,
    end,
    encoding: "json",
    compression: "none",
    pretty_px: "true",
    pretty_ts: "true",
    map_symbols: "true",
    stype_in: "raw_symbol",
    stype_out: "instrument_id",
  })

  const response = await fetch(DATABENTO_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  })

  const text = await response.text()

  if (!response.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string } | string; message?: string }
      detail =
        typeof parsed.detail === "object"
          ? parsed.detail?.message ?? parsed.message ?? response.statusText
          : parsed.detail ?? parsed.message ?? response.statusText
    } catch {
      detail = text || response.statusText
    }

    throw new Error(`Databento ${response.status}: ${detail}`)
  }

  return parseDatabentoJsonl(text)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const requestedSymbol = (searchParams.get("symbol") ?? "SPY").toUpperCase()
  const symbol = isAssetSymbol(requestedSymbol) ? requestedSymbol : "SPY"
  const months = clampMonths(searchParams.get("months"))
  const asset = getAsset(symbol)
  const apiKey = process.env.DATABENTO_API_KEY

  if (!apiKey) {
    return Response.json({
      symbol,
      label: asset.label,
      name: asset.name,
      dataSymbol: asset.dataSymbol,
      dataset: asset.dataset,
      schema: asset.schema,
      source: "demo",
      note: "demo data is showing because DATABENTO_API_KEY is not set in .env.local.",
      candles: generateDemoCandles(symbol, months),
    })
  }

  try {
    const candles = await fetchDatabentoCandles({
      dataSymbol: asset.dataSymbol,
      dataset: asset.dataset,
      schema: asset.schema,
      months,
      apiKey,
    })

    return Response.json({
      symbol,
      label: asset.label,
      name: asset.name,
      dataSymbol: asset.dataSymbol,
      dataset: asset.dataset,
      schema: asset.schema,
      source: "databento",
      note:
        asset.note ??
        "databento EQUS.MINI ohlcv-1d is price-only and does not include dividends, taxes, or fees.",
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
