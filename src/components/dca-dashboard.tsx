"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ComponentType, KeyboardEvent, ReactNode, SVGProps } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowDownIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  CheckIcon,
  Clock3Icon,
  DatabaseIcon,
  DollarSignIcon,
  LineChartIcon,
  PercentIcon,
  SearchIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletCardsIcon,
  XIcon,
} from "lucide-react"

import { ASSETS, FREQUENCIES, getAsset, getFrequency } from "@/lib/assets"
import { calculateDca } from "@/lib/dca"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { PerformanceChart } from "@/components/performance-chart"
import { cn } from "@/lib/utils"
import type { AssetSymbol, Frequency, MarketDataResponse } from "@/types/market"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

const ASSET_SEARCH_LIMIT = 8
const DEFAULT_SALARY = 100_000
const DEFAULT_INVESTMENT_PERCENT = 10
const MIN_INVESTMENT_PERCENT = 1
const MAX_INVESTMENT_PERCENT = 100
const DEFAULT_FREQUENCY: Frequency = "monthly"
const DEFAULT_MONTHS = 36
const MIN_MONTHS = 12
const MAX_MONTHS = 240
const MONTH_STEP = 1.2
const DEFAULT_SYMBOL: AssetSymbol = "SPY"
const DEFAULT_COMPARISON_SYMBOLS: AssetSymbol[] = ["SPY", "NASDAQ", "GOLD"]
const MAX_COMPARISON_ASSETS = 5
const COMPARISON_COLORS = ["#f8c159", "#35d6e6", "#72f25f", "#ff554f", "#f472b6"] as const
const DEFAULT_MARGIN_LEVERAGE = 2
const MIN_MARGIN_LEVERAGE = 1
const MAX_MARGIN_LEVERAGE = 10
const MARGIN_LEVERAGE_STEP = 0.1
const MAINTENANCE_MARGIN_PERCENT = 25
const BUILDER_MODES = [
  { value: "single-asset", label: "single asset" },
  { value: "multi-asset", label: "multi-asset" },
] as const

type Asset = (typeof ASSETS)[number]
type BuilderMode = (typeof BUILDER_MODES)[number]["value"]

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function formatSignedCurrency(value: number) {
  if (value > 0) {
    return `+${formatCurrency(value)}`
  }

  if (value < 0) {
    return `-${formatCurrency(Math.abs(value))}`
  }

  return formatCurrency(value)
}

function formatPercent(value: number, signed = false) {
  const prefix = signed && value > 0 ? "+" : ""
  return `${prefix}${percentFormatter.format(value)}%`
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10
}

function formatInteger(value: number) {
  return integerFormatter.format(Math.round(value))
}

function formatYears(months: number) {
  return roundToTenth(months / 12).toFixed(1)
}

function formatYearLabel(months: number) {
  const years = months / 12

  return Number.isInteger(years) ? `${years}y` : `${years.toFixed(1)}y`
}

function formatLeverage(value: number) {
  return `${roundToTenth(value).toFixed(1)}x`
}

function scaledMetricValueClass(value: string) {
  if (value.length >= 20) {
    return "text-[0.78rem]"
  }

  if (value.length >= 17) {
    return "text-[0.9rem]"
  }

  if (value.length >= 14) {
    return "text-base"
  }

  return "text-xl"
}

function scaledFeatureValueClass(value: string) {
  if (value.length >= 20) {
    return "text-lg"
  }

  if (value.length >= 17) {
    return "text-xl"
  }

  if (value.length >= 14) {
    return "text-2xl"
  }

  return "text-3xl"
}

function formatDataRange(range: MarketDataResponse["range"] | undefined, requestedMonths: number) {
  if (!range?.start || !range.end || range.actualMonths <= 0) {
    return `${requestedMonths} months of daily data`
  }

  if (range.isLimited) {
    return `using ${range.actualMonths} months from ${range.start} to ${range.end}`
  }

  return `${range.actualMonths} months from ${range.start} to ${range.end}`
}

function tileTone(value: number) {
  if (value > 0) {
    return "text-profit"
  }

  if (value < 0) {
    return "text-loss"
  }

  return "text-foreground"
}

function getSliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? value[0] ?? fallback : value
}

function getSafeMarginLeverage({
  candles,
  salary,
  investmentPercent,
  frequency,
}: {
  candles: MarketDataResponse["candles"]
  salary: number
  investmentPercent: number
  frequency: Frequency
}) {
  if (candles.length === 0) {
    return MIN_MARGIN_LEVERAGE
  }

  const testLeverage = (leverage: number) =>
    calculateDca({
      candles,
      salary,
      investmentPercent,
      frequency,
      leverage,
      maintenanceMarginPercent: MAINTENANCE_MARGIN_PERCENT,
    }).isLiquidated

  if (!testLeverage(MAX_MARGIN_LEVERAGE)) {
    return MAX_MARGIN_LEVERAGE
  }

  let low = MIN_MARGIN_LEVERAGE
  let high = MAX_MARGIN_LEVERAGE

  for (let index = 0; index < 24; index += 1) {
    const mid = (low + high) / 2

    if (testLeverage(mid)) {
      high = mid
    } else {
      low = mid
    }
  }

  return Math.floor(Math.max(MIN_MARGIN_LEVERAGE, low) * 10) / 10
}

function normalizeAssetSearch(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function scoreAssetMatch(asset: Asset, normalizedQuery: string) {
  const ticker = normalizeAssetSearch(asset.dataSymbol)
  const symbol = normalizeAssetSearch(asset.symbol)
  const name = normalizeAssetSearch(asset.name)
  const label = normalizeAssetSearch(asset.label)
  const aliases = asset.searchAliases?.map(normalizeAssetSearch) ?? []

  if (ticker === normalizedQuery || symbol === normalizedQuery || aliases.includes(normalizedQuery)) {
    return 0
  }

  if (ticker.startsWith(normalizedQuery)) {
    return 1
  }

  if (symbol.startsWith(normalizedQuery)) {
    return 2
  }

  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) {
    return 3
  }

  if (name.startsWith(normalizedQuery)) {
    return 4
  }

  if (ticker.includes(normalizedQuery)) {
    return 5
  }

  if (symbol.includes(normalizedQuery)) {
    return 6
  }

  if (aliases.some((alias) => alias.includes(normalizedQuery))) {
    return 6
  }

  if (name.includes(normalizedQuery)) {
    return 7
  }

  if (label.includes(normalizedQuery)) {
    return 8
  }

  return Number.POSITIVE_INFINITY
}

function getAssetSearchMatches(query: string) {
  const normalizedQuery = normalizeAssetSearch(query)

  if (!normalizedQuery) {
    return ASSETS.slice(0, ASSET_SEARCH_LIMIT)
  }

  return ASSETS.map((asset, index) => ({
    asset,
    index,
    score: scoreAssetMatch(asset, normalizedQuery),
  }))
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score
      }

      const aRank = a.asset.marketCapRank ?? Number.POSITIVE_INFINITY
      const bRank = b.asset.marketCapRank ?? Number.POSITIVE_INFINITY

      if (aRank !== bRank) {
        return aRank - bRank
      }

      return a.index - b.index
    })
    .slice(0, ASSET_SEARCH_LIMIT)
    .map((result) => result.asset)
}

function assetOptionId(asset: Asset) {
  return `asset-option-${asset.symbol.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

function useCountUp(targetValue: number, isPaused: boolean, duration = 720) {
  const [displayValue, setDisplayValue] = useState(targetValue)
  const displayValueRef = useRef(targetValue)

  useEffect(() => {
    if (isPaused) {
      return
    }

    if (!Number.isFinite(targetValue)) {
      displayValueRef.current = targetValue
      const animationFrame = requestAnimationFrame(() => setDisplayValue(targetValue))

      return () => cancelAnimationFrame(animationFrame)
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayValueRef.current = targetValue
      const animationFrame = requestAnimationFrame(() => setDisplayValue(targetValue))

      return () => cancelAnimationFrame(animationFrame)
    }

    if (Math.abs(targetValue - displayValueRef.current) < 0.01) {
      displayValueRef.current = targetValue
      const animationFrame = requestAnimationFrame(() => setDisplayValue(targetValue))

      return () => cancelAnimationFrame(animationFrame)
    }

    if (!document.documentElement.animate) {
      displayValueRef.current = targetValue
      const animationFrame = requestAnimationFrame(() => setDisplayValue(targetValue))

      return () => cancelAnimationFrame(animationFrame)
    }

    const startValue = displayValueRef.current

    if (duration <= 0) {
      displayValueRef.current = targetValue
      const animationFrame = requestAnimationFrame(() => setDisplayValue(targetValue))

      return () => cancelAnimationFrame(animationFrame)
    }

    let animationFrame = 0
    const startedAt = performance.now()

    function step(timestamp: number) {
      const progress = Math.min(1, (timestamp - startedAt) / duration)
      const easedProgress = 1 - (1 - progress) ** 3
      const nextValue = startValue + (targetValue - startValue) * easedProgress

      displayValueRef.current = nextValue
      setDisplayValue(nextValue)

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        displayValueRef.current = targetValue
        setDisplayValue(targetValue)
      }
    }

    animationFrame = requestAnimationFrame(step)

    return () => cancelAnimationFrame(animationFrame)
  }, [duration, isPaused, targetValue])

  return displayValue
}

function CountUpValue({
  value,
  format,
  isPaused,
}: {
  value: number
  format: (value: number) => string
  isPaused: boolean
}) {
  const displayValue = useCountUp(value, isPaused)

  return format(displayValue)
}

function ValueSlot({
  children,
  isLoading,
  skeletonClassName,
}: {
  children: ReactNode
  isLoading: boolean
  skeletonClassName: string
}) {
  return (
    <div className="relative min-w-0 max-w-full">
      <div className={cn(isLoading && "invisible")}>{children}</div>
      {isLoading ? (
        <Skeleton className={cn("absolute left-0 top-1/2 -translate-y-1/2", skeletonClassName)} />
      ) : null}
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  isLoading,
  tone = "text-foreground",
  iconTone = "bg-muted text-muted-foreground",
  valueClassName,
  valueSkeletonClassName = "h-8 w-40",
  detailSkeletonClassName = "h-3 w-32",
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon: ComponentType<SVGProps<SVGSVGElement>>
  isLoading: boolean
  tone?: string
  iconTone?: string
  valueClassName?: string
  valueSkeletonClassName?: string
  detailSkeletonClassName?: string
}) {
  return (
    <Card className="dashboard-card metric-card min-h-[6.75rem] gap-0 rounded-lg py-0">
      <CardContent className="flex h-full flex-col justify-between gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-mono text-xs font-medium text-text-secondary">{label}</p>
          <div className={`flex size-7 shrink-0 items-center justify-center rounded-md border ${iconTone}`}>
            <Icon aria-hidden="true" className="size-4" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <ValueSlot isLoading={isLoading} skeletonClassName={valueSkeletonClassName}>
            <p className={cn("max-w-full overflow-hidden whitespace-nowrap font-mono font-semibold leading-none tracking-normal", valueClassName ?? "text-xl", tone)}>
              {value}
            </p>
          </ValueSlot>
          {detail ? (
            <ValueSlot isLoading={isLoading} skeletonClassName={detailSkeletonClassName}>
              <p className="font-mono text-xs leading-5 text-muted-foreground">{detail}</p>
            </ValueSlot>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingChart() {
  return (
    <div className="flex h-[340px] flex-col gap-4 rounded-lg border border-border bg-black/25 p-5 md:h-[360px]">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="min-h-0 flex-1" />
      <div className="flex gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  )
}

function ChartLegend({
  assetSymbol,
  assetLabel,
  isMarginModeEnabled,
}: {
  assetSymbol: string
  assetLabel: string
  isMarginModeEnabled: boolean
}) {
  return (
    <div
      aria-label="chart legend"
      className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-md border border-gold-400/35 bg-gold-400/10 px-1.5 py-0.5 font-mono text-xs text-gold-100">
          {assetSymbol}
        </span>
        <span className="max-w-full truncate sm:max-w-80" title={assetLabel}>
          {assetLabel}
        </span>
        <span
          aria-hidden="true"
          className="h-0.5 w-10 shrink-0 rounded-full bg-chart-2 shadow-[0_0_10px_rgba(53,214,230,0.32)]"
        />
        <span>price return</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "h-0.5 w-10 shrink-0 rounded-full",
            isMarginModeEnabled
              ? "bg-loss shadow-[0_0_10px_rgba(255,85,79,0.35)]"
              : "bg-gold-400 shadow-[0_0_10px_rgba(248,193,89,0.35)]"
          )}
        />
        <span className="font-medium text-foreground">net return</span>
      </div>
      {isMarginModeEnabled ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-10 shrink-0 rounded-full bg-gold-400 shadow-[0_0_10px_rgba(248,193,89,0.35)]"
          />
          <span className="font-medium text-foreground">base net return</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <ArrowDownIcon aria-hidden="true" className="size-4 text-profit" />
        <span>dca buys</span>
      </div>
    </div>
  )
}

function AssetSelectLabel({
  asset,
  className,
}: {
  asset: Asset
  className?: string
}) {
  return (
    <span
      className={cn(
        "grid min-w-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)_2.75rem] items-center gap-3",
        className
      )}
    >
      <span className="font-mono text-sm font-semibold tracking-normal text-foreground">{asset.dataSymbol}</span>
      <span className="min-w-0 truncate text-right text-muted-foreground" title={asset.name}>
        {asset.name}
      </span>
      <span className="text-right font-mono text-xs text-text-muted">
        {asset.kind}
      </span>
    </span>
  )
}

function AssetSearchCombobox({
  id,
  selectedAsset,
  onValueChange,
  onSearchStart,
}: {
  id: string
  selectedAsset: Asset
  onValueChange: (symbol: AssetSymbol) => void
  onSearchStart: () => void
}) {
  const [query, setQuery] = useState(selectedAsset.dataSymbol)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const matches = useMemo(() => getAssetSearchMatches(query), [query])
  const boundedHighlightedIndex = matches.length ? Math.min(highlightedIndex, matches.length - 1) : 0
  const highlightedAsset = matches[boundedHighlightedIndex]
  const listboxId = "asset-search-listbox"

  function selectAsset(asset: Asset) {
    onSearchStart()
    onValueChange(asset.symbol)
    setQuery(asset.dataSymbol)
    setIsOpen(false)
    setHighlightedIndex(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setIsOpen(true)
      setHighlightedIndex((currentIndex) => (matches.length ? (currentIndex + 1) % matches.length : 0))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setIsOpen(true)
      setHighlightedIndex((currentIndex) => (matches.length ? (currentIndex - 1 + matches.length) % matches.length : 0))
      return
    }

    if (event.key === "Enter" && isOpen && highlightedAsset) {
      event.preventDefault()
      selectAsset(highlightedAsset)
      return
    }

    if (event.key === "Escape") {
      setIsOpen(false)
      setQuery(selectedAsset.dataSymbol)
      setHighlightedIndex(0)
    }
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false)
          setQuery(selectedAsset.dataSymbol)
          setHighlightedIndex(0)
        }
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-profit"
      />
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-activedescendant={isOpen && highlightedAsset ? assetOptionId(highlightedAsset) : undefined}
        autoComplete="off"
        className="soft-control h-12 rounded-lg pl-10 pr-3 font-mono text-sm font-semibold tracking-normal"
        placeholder="search ticker or company"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlightedIndex(0)
          setIsOpen(true)
        }}
        onFocus={(event) => {
          event.currentTarget.select()
          setHighlightedIndex(0)
          setIsOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40"
        >
          {matches.length ? (
            matches.map((asset, index) => {
              const isHighlighted = boundedHighlightedIndex === index
              const isSelected = selectedAsset.symbol === asset.symbol

              return (
                <button
                  key={asset.symbol}
                  id={assetOptionId(asset)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors",
                    isHighlighted ? "bg-profit/10 text-foreground" : "text-foreground hover:bg-secondary/80"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectAsset(asset)}
                >
                  <AssetSelectLabel asset={asset} />
                  <CheckIcon
                    aria-hidden="true"
                    className={cn("size-4 shrink-0 text-profit", isSelected ? "opacity-100" : "opacity-0")}
                  />
                </button>
              )
            })
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">no matching assets</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function RailHeading({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-profit" />
        <h2 className="font-mono text-sm font-semibold text-profit">{title}</h2>
      </div>
      <p className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">{`// ${description}`}</p>
    </div>
  )
}

function ScaleLabels({
  labels,
  max,
  min,
}: {
  labels: Array<{ label: string; value: number }>
  max: number
  min: number
}) {
  return (
    <div className="relative h-5 font-mono text-xs text-muted-foreground">
      {labels.map(({ label, value }) => {
        const position = ((value - min) / Math.max(1, max - min)) * 100
        const translateClass = position <= 0 ? "translate-x-0" : position >= 100 ? "-translate-x-full" : "-translate-x-1/2"

        return (
          <span
            key={label}
            className={`absolute top-0 whitespace-nowrap ${translateClass}`}
            style={{ left: `${Math.min(100, Math.max(0, position))}%` }}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

function SelectedAssetCard({
  asset,
  dataset,
  schema,
}: {
  asset: Asset
  dataset?: string
  schema?: string
}) {
  return (
    <div className="rounded-lg border border-profit/35 bg-profit/5 p-4 shadow-[inset_3px_0_0_rgba(114,242,95,0.88)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-3xl font-semibold leading-none text-foreground">{asset.dataSymbol}</p>
          <p className="mt-2 truncate text-sm text-text-secondary" title={asset.name}>
            {asset.name}
          </p>
        </div>
        <Badge variant="outline" className="rounded-md border-profit/30 bg-profit/10 font-mono text-profit">
          {asset.kind}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
        <span>{dataset ?? asset.dataset}</span>
        <span aria-hidden="true">·</span>
        <span>{schema ?? asset.schema}</span>
      </div>
    </div>
  )
}

function ComparisonAssetBadges({
  assets,
  className,
  onRemove,
  onSelect,
  selectedSymbol,
}: {
  assets: Array<{
    color: string
    dataSymbol: string
    isLoading: boolean
    name: string
    symbol: AssetSymbol
  }>
  className?: string
  onRemove: (symbol: AssetSymbol) => void
  onSelect: (symbol: AssetSymbol) => void
  selectedSymbol: AssetSymbol
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {assets.map((asset) => {
        const isSelected = asset.symbol === selectedSymbol

        return (
          <div
            key={asset.symbol}
            className={cn(
              "group flex min-h-9 max-w-full items-center overflow-hidden rounded-md border font-mono text-xs transition-colors",
              isSelected ? "bg-bg-card-hover text-foreground shadow-[0_0_18px_rgba(114,242,95,0.12)]" : "bg-bg-primary/65 text-text-secondary hover:bg-bg-card-hover hover:text-foreground"
            )}
            style={{
              borderColor: isSelected ? asset.color : `${asset.color}66`,
              boxShadow: isSelected ? `inset 3px 0 0 ${asset.color}` : undefined,
            }}
          >
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(asset.symbol)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-profit/40"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: asset.color }} />
              <span className="min-w-0">
                <span className="block leading-none">{asset.dataSymbol}</span>
                <span className="mt-1 block max-w-36 truncate text-[0.65rem] text-muted-foreground" title={asset.name}>
                  {isSelected ? "selected" : asset.isLoading ? "loading" : asset.name}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`remove ${asset.dataSymbol}`}
              className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-loss/15 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss/30"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(asset.symbol)
              }}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function StatusLine({
  isError,
  sourceLabel,
}: {
  isError: boolean
  sourceLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 font-mono text-xs text-muted-foreground">
      <div className={cn("flex items-center gap-2", isError ? "text-loss" : "text-profit")}>
        <span className="status-pulse-dot" />
        <span>{isError ? "attention" : "ready"}</span>
        <span className="text-muted-foreground">{isError ? "market feed needs review" : "all systems operational"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span>source: {sourceLabel}</span>
        <span>currency: USD</span>
      </div>
    </div>
  )
}

export function DcaDashboard() {
  const [salary, setSalary] = useState(DEFAULT_SALARY)
  const [investmentPercent, setInvestmentPercent] = useState(DEFAULT_INVESTMENT_PERCENT)
  const [frequency, setFrequency] = useState<Frequency>(DEFAULT_FREQUENCY)
  const [months, setMonths] = useState(DEFAULT_MONTHS)
  const [symbol, setSymbol] = useState<AssetSymbol>(DEFAULT_SYMBOL)
  const [builderMode, setBuilderMode] = useState<BuilderMode>("single-asset")
  const [isMarginModeEnabled, setIsMarginModeEnabled] = useState(false)
  const [marginLeverage, setMarginLeverage] = useState(DEFAULT_MARGIN_LEVERAGE)
  const [comparisonSymbols, setComparisonSymbols] = useState<AssetSymbol[]>(DEFAULT_COMPARISON_SYMBOLS)
  const [selectedComparisonSymbol, setSelectedComparisonSymbol] = useState<AssetSymbol>(DEFAULT_COMPARISON_SYMBOLS[0])
  const [comparisonMarketData, setComparisonMarketData] = useState<Record<AssetSymbol, MarketDataResponse>>({})
  const [comparisonErrors, setComparisonErrors] = useState<Record<AssetSymbol, string>>({})
  const [isComparisonLoading, setIsComparisonLoading] = useState(false)
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startRecalculation = () => setIsRecalculating(true)

  function addComparisonAsset(nextSymbol: AssetSymbol) {
    startRecalculation()
    setSelectedComparisonSymbol(nextSymbol)
    setComparisonSymbols((currentSymbols) => {
      if (currentSymbols.includes(nextSymbol)) {
        return currentSymbols
      }

      if (currentSymbols.length >= MAX_COMPARISON_ASSETS) {
        return currentSymbols
      }

      return [...currentSymbols, nextSymbol]
    })
  }

  function removeComparisonAsset(nextSymbol: AssetSymbol) {
    startRecalculation()
    setComparisonSymbols((currentSymbols) => {
      const nextSymbols = currentSymbols.filter((item) => item !== nextSymbol)

      if (selectedComparisonSymbol === nextSymbol) {
        setSelectedComparisonSymbol(nextSymbols[0] ?? DEFAULT_SYMBOL)
      }

      return nextSymbols
    })
  }

  function selectComparisonAsset(nextSymbol: AssetSymbol) {
    startRecalculation()
    setSelectedComparisonSymbol(nextSymbol)
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadMarketData() {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ symbol, months: String(months) })
        const response = await fetch(`/api/market-data?${params.toString()}`, {
          signal: controller.signal,
        })
        const payload = (await response.json()) as MarketDataResponse | { error?: string }

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "unable to load market data.")
        }

        const nextMarketData = payload as MarketDataResponse
        const availableMonths = nextMarketData.availability?.months

        if (availableMonths) {
          const maxSelectableMonths = roundToTenth(Math.max(MIN_MONTHS, Math.min(MAX_MONTHS, availableMonths)))

          if (months > maxSelectableMonths) {
            setIsRecalculating(true)
            setMonths(maxSelectableMonths)
          }
        }

        setMarketData(nextMarketData)
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return
        }

        setError(caughtError instanceof Error ? caughtError.message : "unable to load market data.")
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadMarketData()

    return () => controller.abort()
  }, [months, symbol])

  useEffect(() => {
    if (builderMode !== "multi-asset" || comparisonSymbols.length === 0) {
      return
    }

    const controller = new AbortController()

    async function loadComparisonMarketData() {
      setIsComparisonLoading(true)

      const nextMarketData: Record<AssetSymbol, MarketDataResponse> = {}
      const nextErrors: Record<AssetSymbol, string> = {}

      await Promise.all(
        comparisonSymbols.map(async (comparisonSymbol) => {
          try {
            const params = new URLSearchParams({ symbol: comparisonSymbol, months: String(months) })
            const response = await fetch(`/api/market-data?${params.toString()}`, {
              signal: controller.signal,
            })
            const payload = (await response.json()) as MarketDataResponse | { error?: string }

            if (!response.ok) {
              throw new Error("error" in payload ? payload.error : "unable to load market data.")
            }

            nextMarketData[comparisonSymbol] = payload as MarketDataResponse
          } catch (caughtError) {
            if (controller.signal.aborted) {
              return
            }

            nextErrors[comparisonSymbol] = caughtError instanceof Error ? caughtError.message : "unable to load market data."
          }
        })
      )

      if (controller.signal.aborted) {
        return
      }

      setComparisonMarketData((currentMarketData) => ({
        ...currentMarketData,
        ...nextMarketData,
      }))
      setComparisonErrors(nextErrors)
      setIsComparisonLoading(false)
    }

    void loadComparisonMarketData()

    return () => controller.abort()
  }, [builderMode, comparisonSymbols, months])

  useEffect(() => {
    if (!isRecalculating) {
      return
    }

    const timeout = window.setTimeout(() => setIsRecalculating(false), 280)

    return () => window.clearTimeout(timeout)
  }, [
    frequency,
    investmentPercent,
    isMarginModeEnabled,
    isRecalculating,
    marginLeverage,
    months,
    salary,
    symbol,
    selectedComparisonSymbol,
  ])

  const singleSelectedAsset = getAsset(symbol)
  const singleSelectedMarketData = marketData?.dataSymbol === singleSelectedAsset.dataSymbol ? marketData : null
  const comparisonResults = useMemo(
    () =>
      comparisonSymbols.map((comparisonSymbol, index) => {
        const asset = getAsset(comparisonSymbol)
        const data = comparisonMarketData[comparisonSymbol]
        const selectedData = data?.dataSymbol === asset.dataSymbol ? data : null

        return {
          asset,
          color: COMPARISON_COLORS[index % COMPARISON_COLORS.length],
          error: comparisonErrors[comparisonSymbol] ?? null,
          isLoading: isComparisonLoading && !selectedData,
          marketData: selectedData,
          summary: calculateDca({
            candles: selectedData?.candles ?? [],
            salary,
            investmentPercent,
            frequency,
          }),
          symbol: comparisonSymbol,
        }
      }),
    [comparisonErrors, comparisonMarketData, comparisonSymbols, frequency, investmentPercent, isComparisonLoading, salary]
  )
  const selectedComparisonResult = comparisonResults.find((result) => result.symbol === selectedComparisonSymbol) ?? comparisonResults[0]
  const selectedComparisonAsset = selectedComparisonResult?.asset ?? getAsset(selectedComparisonSymbol)
  const selectedComparisonMarketData = selectedComparisonResult?.marketData ?? null
  const activeLeverage = isMarginModeEnabled ? marginLeverage : MIN_MARGIN_LEVERAGE
  const singleSummary = useMemo(
    () =>
      calculateDca({
        candles: singleSelectedMarketData?.candles ?? [],
        salary,
        investmentPercent,
        frequency,
        leverage: activeLeverage,
        maintenanceMarginPercent: MAINTENANCE_MARGIN_PERCENT,
      }),
    [activeLeverage, frequency, investmentPercent, singleSelectedMarketData?.candles, salary]
  )
  const baseSingleSummary = useMemo(
    () =>
      calculateDca({
        candles: singleSelectedMarketData?.candles ?? [],
        salary,
        investmentPercent,
        frequency,
      }),
    [frequency, investmentPercent, singleSelectedMarketData?.candles, salary]
  )
  const safeMarginLeverage = useMemo(
    () =>
      getSafeMarginLeverage({
        candles: singleSelectedMarketData?.candles ?? [],
        salary,
        investmentPercent,
        frequency,
      }),
    [frequency, investmentPercent, singleSelectedMarketData?.candles, salary]
  )
  const selectedAsset = builderMode === "multi-asset" ? selectedComparisonAsset : singleSelectedAsset
  const selectedMarketData = builderMode === "multi-asset" ? selectedComparisonMarketData : singleSelectedMarketData
  const summary =
    builderMode === "multi-asset"
      ? selectedComparisonResult?.summary ??
        calculateDca({
          candles: [],
          salary,
          investmentPercent,
          frequency,
        })
      : singleSummary

  const selectedFrequency = getFrequency(frequency)
  const annualInvestment = salary * (investmentPercent / 100)
  const salaryInputValue = formatInteger(salary)
  const activeError = builderMode === "multi-asset" ? selectedComparisonResult?.error ?? null : error
  const sourceLabel =
    selectedMarketData?.source === "databento"
      ? "databento"
      : selectedMarketData?.source === "coinmetrics"
      ? "coin metrics"
      : selectedMarketData?.source === "coingecko"
      ? "coingecko"
      : "demo data"
  const chartAssetSymbol = selectedMarketData?.dataSymbol ?? selectedAsset.dataSymbol
  const chartAssetLabel = selectedMarketData?.name ?? selectedAsset.name
  const comparisonChartAssets = comparisonResults
    .filter((result) => result.marketData?.candles.length)
    .map((result) => ({
      id: result.symbol,
      label: result.marketData?.dataSymbol ?? result.asset.dataSymbol,
      name: result.marketData?.name ?? result.asset.name,
      color: result.color,
      candles: result.marketData?.candles ?? [],
      portfolio: result.summary.portfolio,
      purchases: result.summary.purchases,
      isSelected: result.symbol === selectedComparisonSymbol,
    }))
  const comparisonBadgeAssets = comparisonResults.map((result) => ({
    color: result.color,
    dataSymbol: result.marketData?.dataSymbol ?? result.asset.dataSymbol,
    isLoading: result.isLoading,
    name: result.marketData?.name ?? result.asset.name,
    symbol: result.symbol,
  }))
  const isValueLoading = builderMode === "multi-asset" ? Boolean(selectedComparisonResult?.isLoading) : isLoading
  const dataRange = selectedMarketData?.range
  const availableMonths = selectedMarketData?.availability?.months ?? MAX_MONTHS
  const limitedMonths = dataRange?.isLimited && dataRange.actualMonths > 0 ? dataRange.actualMonths : null
  const maxSelectableMonths = roundToTenth(Math.max(MIN_MONTHS, Math.min(MAX_MONTHS, limitedMonths ?? availableMonths)))
  const selectedMonths = roundToTenth(Math.min(months, maxSelectableMonths))
  const effectiveMonths = dataRange?.actualMonths && dataRange.actualMonths > 0 ? dataRange.actualMonths : months
  const timePeriodLabel = dataRange?.isLimited ? `${formatYears(effectiveMonths)} years available` : `${formatYears(months)} years`
  const isMarginLiquidated = isMarginModeEnabled && builderMode === "single-asset" && summary.isLiquidated
  const chartPortfolio =
    isMarginLiquidated && summary.liquidationDate
      ? summary.portfolio.filter((point) => point.time <= summary.liquidationDate!)
      : summary.portfolio
  const chartPurchases =
    isMarginLiquidated && summary.liquidationDate
      ? summary.purchases.filter((purchase) => purchase.time <= summary.liquidationDate!)
      : summary.purchases
  const baseChartPortfolio = isMarginModeEnabled && builderMode === "single-asset" ? baseSingleSummary.portfolio : []
  const liquidationDetail =
    summary.liquidationDate && summary.liquidationPrice
      ? `hit ${summary.liquidationDate} near ${formatCurrency(summary.liquidationPrice)}`
      : "maintenance breach in range"
  const marginSafetyLabel =
    safeMarginLeverage >= MAX_MARGIN_LEVERAGE
      ? `${formatLeverage(MAX_MARGIN_LEVERAGE)} stayed above maintenance`
      : `liquidation starts above about ${formatLeverage(safeMarginLeverage)}`
  const totalInvestedValueClass = scaledMetricValueClass(formatCurrency(summary.totalInvested))
  const currentValueClass = scaledMetricValueClass(isMarginLiquidated ? "liquidated" : formatCurrency(summary.currentValue))
  const netReturnValueClass = scaledMetricValueClass(isMarginLiquidated ? "liquidated" : formatPercent(summary.netReturnPct, true))
  const maxDrawdownValueClass = scaledMetricValueClass(isMarginLiquidated ? "liquidated" : formatPercent(summary.maxDrawdownPct))
  const averageBuyPriceValueClass = scaledMetricValueClass(formatCurrency(summary.averageBuyPrice))
  const assetMoveValueClass = scaledFeatureValueClass(formatPercent(summary.assetReturnPct, true))
  const returnCaptureValueClass = scaledFeatureValueClass(
    isMarginLiquidated ? "liquidated" : summary.moveCapturePct === null ? "n/a" : formatPercent(summary.moveCapturePct)
  )
  const dollarsCapturedValueClass = scaledFeatureValueClass(
    isMarginLiquidated ? "liquidated" : formatSignedCurrency(summary.netReturnDollars)
  )
  const timeScaleLabels =
    maxSelectableMonths <= MIN_MONTHS
      ? [{ label: "1y", value: MIN_MONTHS }]
      : [
          { label: "1y", value: MIN_MONTHS },
          { label: formatYearLabel(maxSelectableMonths), value: maxSelectableMonths },
        ]
  const activePanelId = `${builderMode}-builder-panel`

  return (
    <main className="min-h-svh p-3 sm:p-4 lg:p-5">
      <div className="console-frame relative mx-auto flex min-h-[calc(100svh-1.5rem)] max-w-[1540px] flex-col overflow-hidden rounded-lg border border-border">
        <header className="relative z-10 flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center text-profit">
              <ShoppingBagIcon aria-hidden="true" className="size-8" />
            </div>
            <div>
              <h1 className="font-mono text-3xl font-semibold leading-none tracking-normal text-profit sm:text-4xl">
                bag builder
              </h1>
              <p className="mt-2 font-mono text-xs text-text-secondary sm:text-sm">
                build the position before it builds you
              </p>
            </div>
          </div>
        </header>

        <nav className="relative z-10 border-b border-border bg-bg-secondary/60 px-3 py-2 sm:px-5" aria-label="builder mode">
          <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-bg-primary/70 p-1">
            {BUILDER_MODES.map((mode) => {
              const isSelected = builderMode === mode.value

              return (
                <button
                  key={mode.value}
                  type="button"
                  role="tab"
                  id={`${mode.value}-builder-tab`}
                  aria-selected={isSelected}
                  aria-controls={`${mode.value}-builder-panel`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return
                    }

                    setBuilderMode(mode.value)
                  }}
                  onFocus={() => setBuilderMode(mode.value)}
                  onClick={() => setBuilderMode(mode.value)}
                  className={cn(
                    "min-h-10 shrink-0 rounded-md px-4 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-profit/40 sm:text-sm",
                    isSelected
                      ? "bg-profit text-bg-primary shadow-[0_0_18px_rgba(114,242,95,0.18)]"
                      : "text-text-secondary hover:bg-bg-card-hover hover:text-foreground"
                  )}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
        </nav>

        <div
          id={activePanelId}
          role="tabpanel"
          aria-labelledby={`${builderMode}-builder-tab`}
          className="relative z-10 grid flex-1 lg:grid-cols-[380px_minmax(0,1fr)]"
        >
          <>
          <aside className="flex flex-col border-b border-border bg-bg-secondary/70 lg:border-b-0 lg:border-r">
            <div className="flex flex-1 flex-col gap-8 p-5">
              <RailHeading title="investment parameters" description="configure your dca" icon={SlidersHorizontalIcon} />

              <FieldGroup className="gap-7">
                <Field>
                  <FieldLabel htmlFor="salary" className="items-center font-mono text-sm text-text-secondary">
                    <DollarSignIcon className="size-4 text-profit" />
                    annual salary
                  </FieldLabel>
                  <div className="relative">
                    <Input
                      id="salary"
                      inputMode="numeric"
                      type="text"
                      value={salaryInputValue}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value.replace(/[^\d]/g, ""))
                        startRecalculation()
                        setSalary(Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0)
                      }}
                      className="soft-control h-12 rounded-lg pr-14 font-mono text-base"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      usd
                    </span>
                  </div>
                  <FieldDescription className="font-mono text-xs">income before contribution math</FieldDescription>
                </Field>

                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldTitle className="font-mono text-sm text-text-secondary">
                      <PercentIcon className="size-4 text-profit" />
                      investment percentage
                    </FieldTitle>
                    <span className="font-mono text-sm text-profit">{investmentPercent}%</span>
                  </div>
                  <Slider
                    min={MIN_INVESTMENT_PERCENT}
                    max={MAX_INVESTMENT_PERCENT}
                    step={1}
                    value={[investmentPercent]}
                    onValueChange={(value) => {
                      startRecalculation()
                      setInvestmentPercent(getSliderValue(value, DEFAULT_INVESTMENT_PERCENT))
                    }}
                    className="py-3 [&_[data-slot=slider-range]]:bg-profit [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-profit [&_[data-slot=slider-thumb]]:bg-profit [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-input"
                  />
                  <ScaleLabels
                    min={MIN_INVESTMENT_PERCENT}
                    max={MAX_INVESTMENT_PERCENT}
                    labels={[
                      { label: "1%", value: MIN_INVESTMENT_PERCENT },
                      { label: "100%", value: MAX_INVESTMENT_PERCENT },
                    ]}
                  />
                  <FieldDescription className="font-mono text-xs">
                    annual investment: {formatCurrency(annualInvestment)}
                  </FieldDescription>
                </Field>

                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldTitle className="font-mono text-sm text-text-secondary">
                      <CalendarDaysIcon className="size-4 text-profit" />
                      time period
                    </FieldTitle>
                    <span className="font-mono text-sm text-profit">{timePeriodLabel}</span>
                  </div>
                  <Slider
                    min={MIN_MONTHS}
                    max={maxSelectableMonths}
                    step={MONTH_STEP}
                    value={[selectedMonths]}
                    onValueChange={(value) => {
                      startRecalculation()
                      setMonths(getSliderValue(value, DEFAULT_MONTHS))
                    }}
                    className="py-3 [&_[data-slot=slider-range]]:bg-profit [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-profit [&_[data-slot=slider-thumb]]:bg-profit [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-input"
                  />
                  <ScaleLabels min={MIN_MONTHS} max={maxSelectableMonths} labels={timeScaleLabels} />
                  <FieldDescription className="font-mono text-xs">{formatDataRange(dataRange, months)}</FieldDescription>
                  {builderMode === "single-asset" ? (
                    <>
                      <label
                        htmlFor="margin-mode"
                        className="mt-3 flex min-h-10 items-center gap-3 rounded-lg border border-loss/35 bg-loss-dim/10 px-3 font-mono text-sm font-semibold text-loss transition-colors hover:bg-loss-dim/15"
                      >
                        <input
                          id="margin-mode"
                          type="checkbox"
                          checked={isMarginModeEnabled}
                          onChange={(event) => {
                            startRecalculation()
                            setIsMarginModeEnabled(event.target.checked)
                          }}
                          className="size-4 rounded border-loss accent-loss"
                        />
                        <AlertTriangleIcon aria-hidden="true" className="size-4" />
                        <span>margin mode?</span>
                      </label>
                      {isMarginModeEnabled ? (
                        <div className="mt-3 rounded-lg border border-loss/30 bg-loss-dim/10 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <FieldTitle className="font-mono text-sm text-loss">
                              <AlertTriangleIcon className="size-4 text-loss" />
                              leverage
                            </FieldTitle>
                            <span className="font-mono text-sm text-loss">{formatLeverage(marginLeverage)}</span>
                          </div>
                          <Slider
                            min={MIN_MARGIN_LEVERAGE}
                            max={MAX_MARGIN_LEVERAGE}
                            step={MARGIN_LEVERAGE_STEP}
                            value={[marginLeverage]}
                            onValueChange={(value) => {
                              startRecalculation()
                              setMarginLeverage(roundToTenth(getSliderValue(value, DEFAULT_MARGIN_LEVERAGE)))
                            }}
                            className="py-3 [&_[data-slot=slider-range]]:bg-loss [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-loss [&_[data-slot=slider-thumb]]:bg-loss [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-loss-dim/35"
                          />
                          <ScaleLabels
                            min={MIN_MARGIN_LEVERAGE}
                            max={MAX_MARGIN_LEVERAGE}
                            labels={[
                              { label: "1x", value: MIN_MARGIN_LEVERAGE },
                              { label: "10x", value: MAX_MARGIN_LEVERAGE },
                            ]}
                          />
                          <FieldDescription className="font-mono text-xs text-loss/80">
                            exposure: {formatCurrency(summary.grossAmountPerPurchase)} per buy, borrowed:{" "}
                            {formatCurrency(summary.borrowedAmountPerPurchase)}. {marginSafetyLabel}.
                          </FieldDescription>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel className="items-center font-mono text-sm text-text-secondary">
                    <Clock3Icon className="size-4 text-profit" />
                    purchase frequency
                  </FieldLabel>
                  <Select
                    items={FREQUENCIES.map((item) => ({ label: item.label, value: item.value }))}
                    value={frequency}
                    onValueChange={(value) => {
                      if (!value) {
                        return
                      }

                      startRecalculation()
                      setFrequency(value as Frequency)
                    }}
                  >
                    <SelectTrigger className="soft-control h-12 w-full rounded-lg font-mono">
                      <SelectValue placeholder="monthly" />
                    </SelectTrigger>
                    <SelectContent className="border border-border">
                      <SelectGroup>
                        {FREQUENCIES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription className="font-mono text-xs">{selectedFrequency.cadenceLabel}</FieldDescription>
                </Field>

                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="asset-search" className="items-center font-mono text-sm text-text-secondary">
                      <TrendingUpIcon className="size-4 text-profit" />
                      {builderMode === "multi-asset" ? "compare assets" : "asset search"}
                    </FieldLabel>
                    <Badge
                      variant="outline"
                      className="rounded-md border-border bg-secondary/40 font-mono text-text-secondary"
                    >
                      {builderMode === "multi-asset" ? `${comparisonSymbols.length}/${MAX_COMPARISON_ASSETS}` : `assets: ${ASSETS.length}`}
                    </Badge>
                  </div>
                  {builderMode === "multi-asset" ? (
                    <>
                      <AssetSearchCombobox
                        key={`comparison-${selectedComparisonSymbol}-${comparisonSymbols.join("-")}`}
                        id="asset-search"
                        selectedAsset={selectedComparisonAsset}
                        onSearchStart={startRecalculation}
                        onValueChange={addComparisonAsset}
                      />
                      <ComparisonAssetBadges
                        assets={comparisonBadgeAssets}
                        onRemove={removeComparisonAsset}
                        onSelect={selectComparisonAsset}
                        selectedSymbol={selectedComparisonResult?.symbol ?? selectedComparisonSymbol}
                      />
                      <SelectedAssetCard
                        asset={selectedComparisonAsset}
                        dataset={selectedComparisonMarketData?.dataset}
                        schema={selectedComparisonMarketData?.schema}
                      />
                      <FieldDescription className="font-mono text-xs">
                        {comparisonSymbols.length >= MAX_COMPARISON_ASSETS
                          ? "comparison limit reached"
                          : selectedComparisonAsset.description}
                      </FieldDescription>
                    </>
                  ) : (
                    <>
                      <AssetSearchCombobox
                        key={singleSelectedAsset.symbol}
                        id="asset-search"
                        selectedAsset={singleSelectedAsset}
                        onSearchStart={startRecalculation}
                        onValueChange={setSymbol}
                      />
                      <SelectedAssetCard
                        asset={singleSelectedAsset}
                        dataset={singleSelectedMarketData?.dataset}
                        schema={singleSelectedMarketData?.schema}
                      />
                      <FieldDescription className="font-mono text-xs">{singleSelectedAsset.description}</FieldDescription>
                    </>
                  )}
                </Field>
              </FieldGroup>
            </div>
          </aside>

          <section className="min-w-0">
            <section className="border-b border-border p-4">
              <RailHeading title="key metrics" description="overview" icon={ActivityIcon} />
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <MetricTile
                  label="total invested"
                  value={<CountUpValue value={summary.totalInvested} format={formatCurrency} isPaused={isValueLoading} />}
                  detail={
                    isMarginModeEnabled && builderMode === "single-asset" ? (
                      <>
                        <CountUpValue value={summary.grossAmountPerPurchase} format={formatCurrency} isPaused={isValueLoading} /> per buy
                      </>
                    ) : (
                      <>
                        <CountUpValue value={summary.amountPerPurchase} format={formatCurrency} isPaused={isValueLoading} /> per buy
                      </>
                    )
                  }
                  icon={DollarSignIcon}
                  isLoading={isValueLoading}
                  tone="text-gold-400"
                  iconTone="border-gold-400/25 bg-gold-500/15 text-gold-400"
                  valueClassName={totalInvestedValueClass}
                />
                <MetricTile
                  label="current value"
                  value={
                    isMarginLiquidated ? (
                      "liquidated"
                    ) : (
                      <CountUpValue value={summary.currentValue} format={formatCurrency} isPaused={isValueLoading} />
                    )
                  }
                  detail={
                    isMarginLiquidated ? (
                      liquidationDetail
                    ) : (
                      <>
                        <CountUpValue value={summary.latestPrice} format={formatCurrency} isPaused={isValueLoading} /> per share
                      </>
                    )
                  }
                  icon={BarChart3Icon}
                  isLoading={isValueLoading}
                  tone={isMarginLiquidated ? "text-loss" : "text-profit"}
                  iconTone={isMarginLiquidated ? "border-loss/25 bg-loss/15 text-loss" : "border-profit/25 bg-profit/15 text-profit"}
                  valueClassName={currentValueClass}
                />
                <MetricTile
                  label="net return"
                  value={
                    isMarginLiquidated ? (
                      "liquidated"
                    ) : (
                      <CountUpValue
                        value={summary.netReturnPct}
                        format={(value) => formatPercent(value, true)}
                        isPaused={isValueLoading}
                      />
                    )
                  }
                  detail={
                    isMarginLiquidated ? (
                      liquidationDetail
                    ) : (
                      <CountUpValue value={summary.netReturnDollars} format={formatCurrency} isPaused={isValueLoading} />
                    )
                  }
                  icon={TrendingUpIcon}
                  isLoading={isValueLoading}
                  tone={isMarginLiquidated ? "text-loss" : tileTone(summary.netReturnPct)}
                  iconTone={
                    isMarginLiquidated || summary.netReturnPct < 0
                      ? "border-loss/25 bg-loss/15 text-loss"
                      : "border-profit/25 bg-profit/15 text-profit"
                  }
                  valueClassName={netReturnValueClass}
                />
                <MetricTile
                  label="max drawdown"
                  value={
                    isMarginLiquidated ? (
                      "liquidated"
                    ) : (
                      <CountUpValue
                        value={summary.maxDrawdownPct}
                        format={(value) => formatPercent(value)}
                        isPaused={isValueLoading}
                      />
                    )
                  }
                  detail={
                    isMarginLiquidated ? (
                      liquidationDetail
                    ) : (
                      <CountUpValue value={summary.maxDrawdownDollars} format={formatCurrency} isPaused={isValueLoading} />
                    )
                  }
                  icon={TrendingDownIcon}
                  isLoading={isValueLoading}
                  tone="text-loss"
                  iconTone="border-loss/25 bg-loss/15 text-loss"
                  valueClassName={maxDrawdownValueClass}
                />
                <MetricTile
                  label="average buy price"
                  value={<CountUpValue value={summary.averageBuyPrice} format={formatCurrency} isPaused={isValueLoading} />}
                  detail={
                    <>
                      first close: <CountUpValue value={summary.firstPrice} format={formatCurrency} isPaused={isValueLoading} />
                    </>
                  }
                  icon={ActivityIcon}
                  isLoading={isValueLoading}
                  tone="text-gold-400"
                  iconTone="border-info/25 bg-info/15 text-info"
                  valueClassName={averageBuyPriceValueClass}
                />
              </div>
            </section>

            <section className="chart-panel border-b border-border p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <LineChartIcon aria-hidden="true" className="size-5 text-profit" />
                    <h2 className="font-mono text-sm font-semibold text-profit">performance overview</h2>
                    <span className="font-mono text-xs text-muted-foreground">{"// dca backtest"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1.5 rounded-md border-info/30 bg-info/10 font-mono text-info">
                    <span className={`status-pulse-dot ${selectedMarketData?.source && selectedMarketData.source !== "demo" ? "text-profit" : "text-warning"}`} />
                    <DatabaseIcon aria-hidden="true" className="size-3.5" />
                    source: {sourceLabel}
                  </Badge>
                  <Badge variant="outline" className="rounded-md border-info/30 bg-info/10 font-mono text-info">
                    ticker: {selectedMarketData?.dataSymbol ?? selectedAsset.dataSymbol}
                  </Badge>
                </div>
              </div>
              {builderMode === "multi-asset" ? (
                <ComparisonAssetBadges
                  assets={comparisonBadgeAssets}
                  className="mt-4"
                  onRemove={removeComparisonAsset}
                  onSelect={selectComparisonAsset}
                  selectedSymbol={selectedComparisonResult?.symbol ?? selectedComparisonSymbol}
                />
              ) : null}

              <div className="mt-4">
                {activeError && (builderMode !== "multi-asset" || comparisonChartAssets.length === 0) ? (
                  <div className="flex min-h-[340px] items-center justify-center rounded-lg border border-loss/30 bg-loss-dim/15 p-5 text-loss md:min-h-[360px]">
                    <div className="flex max-w-xl items-start gap-3">
                      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                      <div>
                        <p className="font-medium">market data could not be loaded.</p>
                        <p className="mt-2 text-sm text-loss/80">{activeError}</p>
                      </div>
                    </div>
                  </div>
                ) : isValueLoading && (builderMode !== "multi-asset" || comparisonChartAssets.length === 0) ? (
                  <LoadingChart />
                ) : builderMode === "multi-asset" && comparisonChartAssets.length ? (
                  <PerformanceChart comparisonAssets={comparisonChartAssets} />
                ) : selectedMarketData?.candles.length ? (
                  <>
                    <ChartLegend
                      assetSymbol={chartAssetSymbol}
                      assetLabel={chartAssetLabel}
                      isMarginModeEnabled={isMarginModeEnabled}
                    />
                    <PerformanceChart
                      basePortfolio={baseChartPortfolio}
                      candles={selectedMarketData.candles}
                      netReturnColor={isMarginModeEnabled ? "#ff554f" : undefined}
                      portfolio={chartPortfolio}
                      purchases={chartPurchases}
                    />
                  </>
                ) : (
                  <div className="flex h-[340px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground md:h-[360px]">
                    no candle data available for the selected range.
                  </div>
                )}
              </div>
            </section>

            <section className="grid border-b border-border lg:grid-cols-[1.35fr_0.65fr]">
              <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                <div className="flex items-center gap-2">
                  <TrendingUpIcon aria-hidden="true" className="size-4 text-profit" />
                  <h2 className="font-mono text-sm font-semibold text-profit">move capture</h2>
                  <span className="font-mono text-xs text-muted-foreground">{"// asset performance"}</span>
                </div>
                <div className="mt-4 grid gap-5 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-2 border-border sm:border-r sm:pr-5">
                    <span className="font-mono text-xs text-muted-foreground">asset move</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-24">
                      <span className={cn("block max-w-full overflow-hidden whitespace-nowrap font-mono font-semibold leading-none", assetMoveValueClass, tileTone(summary.assetReturnPct))}>
                        <CountUpValue
                          value={summary.assetReturnPct}
                          format={(value) => formatPercent(value, true)}
                          isPaused={isValueLoading}
                        />
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatSignedCurrency(summary.assetMoveDollars)} per share
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 border-border sm:border-r sm:pr-5">
                    <span className="font-mono text-xs text-muted-foreground">return capture</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-32">
                      <span
                        className={cn(
                          "block max-w-full overflow-hidden whitespace-nowrap font-mono font-semibold leading-none",
                          returnCaptureValueClass,
                          isMarginLiquidated
                            ? "text-loss"
                            : summary.moveCapturePct === null
                              ? "text-muted-foreground"
                              : tileTone(summary.moveCapturePct)
                        )}
                      >
                        {isMarginLiquidated ? (
                          "liquidated"
                        ) : summary.moveCapturePct === null ? (
                          "n/a"
                        ) : (
                          <CountUpValue
                            value={summary.moveCapturePct}
                            format={formatPercent}
                            isPaused={isValueLoading}
                          />
                        )}
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">
                      {isMarginLiquidated ? liquidationDetail : `from the entire ${formatPercent(summary.assetReturnPct)} asset move`}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="font-mono text-xs text-muted-foreground">dollars captured</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-24">
                      <span
                        className={cn(
                          "block max-w-full overflow-hidden whitespace-nowrap font-mono font-semibold leading-none",
                          dollarsCapturedValueClass,
                          isMarginLiquidated ? "text-loss" : tileTone(summary.netReturnDollars)
                        )}
                      >
                        {isMarginLiquidated ? (
                          "liquidated"
                        ) : (
                          <CountUpValue
                            value={summary.netReturnDollars}
                            format={formatSignedCurrency}
                            isPaused={isValueLoading}
                          />
                        )}
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">
                      {isMarginLiquidated ? liquidationDetail : `of ${formatSignedCurrency(summary.fullMoveDollars)} full-period move`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  <WalletCardsIcon aria-hidden="true" className="size-4 text-profit" />
                  <h2 className="font-mono text-sm font-semibold text-profit">data note</h2>
                  <span className="font-mono text-xs text-muted-foreground">{"// important"}</span>
                </div>
                <p className="mt-4 text-sm leading-7 text-text-secondary">
                  {selectedMarketData?.note ??
                    "spy is the default asset. returns are price-only until dividend and adjustment data are added."}
                </p>
              </div>
            </section>
          </section>
          </>
        </div>

        <StatusLine isError={Boolean(activeError)} sourceLabel={sourceLabel} />
      </div>
    </main>
  )
}
