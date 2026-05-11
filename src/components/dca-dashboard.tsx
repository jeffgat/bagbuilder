"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ComponentType, KeyboardEvent, ReactNode, SVGProps } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowDownIcon,
  BarChart3Icon,
  CalculatorIcon,
  CalendarDaysIcon,
  CheckIcon,
  Clock3Icon,
  DatabaseIcon,
  DollarSignIcon,
  LineChartIcon,
  PercentIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletCardsIcon,
} from "lucide-react"

import { ASSETS, FREQUENCIES, getAsset, getFrequency } from "@/lib/assets"
import { calculateDca } from "@/lib/dca"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
const DEFAULT_FREQUENCY: Frequency = "monthly"
const DEFAULT_MONTHS = 36
const DEFAULT_SYMBOL: AssetSymbol = "SPY"

type Asset = (typeof ASSETS)[number]

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function formatPercent(value: number, signed = false) {
  const prefix = signed && value > 0 ? "+" : ""
  return `${prefix}${percentFormatter.format(value)}%`
}

function formatInteger(value: number) {
  return integerFormatter.format(Math.round(value))
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

function normalizeAssetSearch(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function scoreAssetMatch(asset: Asset, normalizedQuery: string) {
  const ticker = normalizeAssetSearch(asset.dataSymbol)
  const symbol = normalizeAssetSearch(asset.symbol)
  const name = normalizeAssetSearch(asset.name)
  const label = normalizeAssetSearch(asset.label)

  if (ticker === normalizedQuery || symbol === normalizedQuery) {
    return 0
  }

  if (ticker.startsWith(normalizedQuery)) {
    return 1
  }

  if (symbol.startsWith(normalizedQuery)) {
    return 2
  }

  if (name.startsWith(normalizedQuery)) {
    return 3
  }

  if (ticker.includes(normalizedQuery)) {
    return 4
  }

  if (symbol.includes(normalizedQuery)) {
    return 5
  }

  if (name.includes(normalizedQuery)) {
    return 6
  }

  if (label.includes(normalizedQuery)) {
    return 7
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
            <p className={`break-words font-mono text-xl font-semibold leading-none tracking-normal ${tone}`}>
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

function ChartLegend({ assetSymbol, assetLabel }: { assetSymbol: string; assetLabel: string }) {
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
          className="h-0.5 w-10 shrink-0 rounded-full bg-profit shadow-[0_0_10px_rgba(114,242,95,0.28)]"
        />
        <span>price candles</span>
        <span className="text-muted-foreground">(left axis)</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-0.5 w-10 shrink-0 rounded-full bg-gold-400 shadow-[0_0_10px_rgba(248,193,89,0.35)]"
        />
        <span className="font-medium text-foreground">portfolio value</span>
        <span className="text-muted-foreground">(right axis)</span>
      </div>
      <div className="flex items-center gap-2">
        <ArrowDownIcon aria-hidden="true" className="size-4 text-gold-0" />
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
        {asset.marketCapRank ? `#${asset.marketCapRank}` : ""}
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

function ScaleLabels({ labels }: { labels: string[] }) {
  return (
    <div className="grid grid-cols-5 gap-2 font-mono text-xs text-muted-foreground">
      {labels.map((label) => (
        <span key={label} className="text-center first:text-left last:text-right">
          {label}
        </span>
      ))}
    </div>
  )
}

function SelectedAssetCard({ asset }: { asset: Asset }) {
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
          {asset.marketCapRank ? `#${asset.marketCapRank}` : "etf"}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
        <span>{asset.dataset}</span>
        <span aria-hidden="true">·</span>
        <span>{asset.schema}</span>
      </div>
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
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startRecalculation = () => setIsRecalculating(true)
  const resetInputs = () => {
    startRecalculation()
    setSalary(DEFAULT_SALARY)
    setInvestmentPercent(DEFAULT_INVESTMENT_PERCENT)
    setFrequency(DEFAULT_FREQUENCY)
    setMonths(DEFAULT_MONTHS)
    setSymbol(DEFAULT_SYMBOL)
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

        setMarketData(payload as MarketDataResponse)
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
    if (!isRecalculating) {
      return
    }

    const timeout = window.setTimeout(() => setIsRecalculating(false), 280)

    return () => window.clearTimeout(timeout)
  }, [frequency, investmentPercent, isRecalculating, months, salary, symbol])

  const summary = useMemo(
    () =>
      calculateDca({
        candles: marketData?.candles ?? [],
        salary,
        investmentPercent,
        frequency,
      }),
    [frequency, investmentPercent, marketData?.candles, salary]
  )

  const selectedAsset = getAsset(symbol)
  const selectedFrequency = getFrequency(frequency)
  const annualInvestment = salary * (investmentPercent / 100)
  const salaryInputValue = formatInteger(salary)
  const sourceLabel = marketData?.source === "databento" ? "databento" : "demo data"
  const chartAssetSymbol = marketData?.dataSymbol ?? selectedAsset.dataSymbol
  const chartAssetLabel = marketData?.name ?? selectedAsset.name
  const isValueLoading = isLoading || isRecalculating

  return (
    <main className="min-h-svh p-3 sm:p-4 lg:p-5">
      <div className="console-frame relative mx-auto flex min-h-[calc(100svh-1.5rem)] max-w-[1540px] flex-col overflow-hidden rounded-lg border border-border">
        <header className="relative z-10 flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-10 items-center justify-center rounded-md border border-profit/70 text-profit shadow-[0_0_22px_rgba(114,242,95,0.16)]">
              <span className="absolute -right-1 -top-1 size-3 border-r border-t border-profit" />
              <CalculatorIcon aria-hidden="true" className="size-5" />
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-info/30 bg-info/10 font-mono text-info">
              assets: {ASSETS.length}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-lg border-border bg-secondary/40 font-mono text-xs text-text-secondary hover:bg-secondary hover:text-foreground"
              onClick={resetInputs}
            >
              <RotateCcwIcon data-icon="inline-start" />
              reset
            </Button>
          </div>
        </header>

        <div className="relative z-10 grid flex-1 lg:grid-cols-[380px_minmax(0,1fr)]">
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
                    min={1}
                    max={60}
                    step={1}
                    value={[investmentPercent]}
                    onValueChange={(value) => {
                      startRecalculation()
                      setInvestmentPercent(getSliderValue(value, DEFAULT_INVESTMENT_PERCENT))
                    }}
                    className="py-3 [&_[data-slot=slider-range]]:bg-profit [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-profit [&_[data-slot=slider-thumb]]:bg-profit [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-input"
                  />
                  <ScaleLabels labels={["1%", "10%", "20%", "30%", "60%"]} />
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
                    <span className="font-mono text-sm text-profit">{(months / 12).toFixed(1)} years</span>
                  </div>
                  <Slider
                    min={12}
                    max={180}
                    step={6}
                    value={[months]}
                    onValueChange={(value) => {
                      startRecalculation()
                      setMonths(getSliderValue(value, DEFAULT_MONTHS))
                    }}
                    className="py-3 [&_[data-slot=slider-range]]:bg-profit [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-profit [&_[data-slot=slider-thumb]]:bg-profit [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-input"
                  />
                  <ScaleLabels labels={["1y", "3y", "5y", "10y", "15y"]} />
                  <FieldDescription className="font-mono text-xs">{months} months of daily data</FieldDescription>
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
                  <FieldLabel htmlFor="asset-search" className="items-center font-mono text-sm text-text-secondary">
                    <TrendingUpIcon className="size-4 text-profit" />
                    asset search
                  </FieldLabel>
                  <AssetSearchCombobox
                    key={selectedAsset.symbol}
                    id="asset-search"
                    selectedAsset={selectedAsset}
                    onSearchStart={startRecalculation}
                    onValueChange={setSymbol}
                  />
                  <SelectedAssetCard asset={selectedAsset} />
                  <FieldDescription className="font-mono text-xs">{selectedAsset.description}</FieldDescription>
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
                    <>
                      <CountUpValue value={summary.amountPerPurchase} format={formatCurrency} isPaused={isValueLoading} /> per{" "}
                      {selectedFrequency.label.toLowerCase()} buy
                    </>
                  }
                  icon={DollarSignIcon}
                  isLoading={isValueLoading}
                  tone="text-gold-400"
                  iconTone="border-gold-400/25 bg-gold-500/15 text-gold-400"
                />
                <MetricTile
                  label="current value"
                  value={<CountUpValue value={summary.currentValue} format={formatCurrency} isPaused={isValueLoading} />}
                  detail={
                    <>
                      <CountUpValue value={summary.totalShares} format={(value) => value.toFixed(3)} isPaused={isValueLoading} />{" "}
                      shares at <CountUpValue value={summary.latestPrice} format={formatCurrency} isPaused={isValueLoading} />
                    </>
                  }
                  icon={BarChart3Icon}
                  isLoading={isValueLoading}
                  tone="text-profit"
                  iconTone="border-profit/25 bg-profit/15 text-profit"
                />
                <MetricTile
                  label="net return"
                  value={
                    <CountUpValue
                      value={summary.netReturnPct}
                      format={(value) => formatPercent(value, true)}
                      isPaused={isValueLoading}
                    />
                  }
                  detail={<CountUpValue value={summary.netReturnDollars} format={formatCurrency} isPaused={isValueLoading} />}
                  icon={TrendingUpIcon}
                  isLoading={isValueLoading}
                  tone={tileTone(summary.netReturnPct)}
                  iconTone={summary.netReturnPct < 0 ? "border-loss/25 bg-loss/15 text-loss" : "border-profit/25 bg-profit/15 text-profit"}
                />
                <MetricTile
                  label="max drawdown"
                  value={
                    <CountUpValue
                      value={summary.maxDrawdownPct}
                      format={(value) => formatPercent(value)}
                      isPaused={isValueLoading}
                    />
                  }
                  detail={<CountUpValue value={summary.maxDrawdownDollars} format={formatCurrency} isPaused={isValueLoading} />}
                  icon={TrendingDownIcon}
                  isLoading={isValueLoading}
                  tone="text-loss"
                  iconTone="border-loss/25 bg-loss/15 text-loss"
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
                  <p className="text-sm text-muted-foreground">
                    daily {selectedAsset.dataSymbol} candles with dca purchase markers and portfolio value.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1.5 rounded-md border-info/30 bg-info/10 font-mono text-info">
                    <span className={`status-pulse-dot ${marketData?.source === "databento" ? "text-profit" : "text-warning"}`} />
                    <DatabaseIcon aria-hidden="true" className="size-3.5" />
                    source: {sourceLabel}
                  </Badge>
                  <Badge variant="outline" className="rounded-md border-info/30 bg-info/10 font-mono text-info">
                    ticker: {marketData?.dataSymbol ?? selectedAsset.dataSymbol}
                  </Badge>
                  <Badge variant="outline" className="rounded-md border-info/30 bg-info/10 font-mono text-info">
                    dataset: {marketData?.dataset ?? selectedAsset.dataset}
                  </Badge>
                  <Badge variant="outline" className="rounded-md border-info/30 bg-info/10 font-mono text-info">
                    schema: {marketData?.schema ?? selectedAsset.schema}
                  </Badge>
                </div>
              </div>

              <div className="mt-4">
                {error ? (
                  <div className="flex min-h-[340px] items-center justify-center rounded-lg border border-loss/30 bg-loss-dim/15 p-5 text-loss md:min-h-[360px]">
                    <div className="flex max-w-xl items-start gap-3">
                      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                      <div>
                        <p className="font-medium">market data could not be loaded.</p>
                        <p className="mt-2 text-sm text-loss/80">{error}</p>
                      </div>
                    </div>
                  </div>
                ) : isLoading ? (
                  <LoadingChart />
                ) : marketData?.candles.length ? (
                  <>
                    <ChartLegend assetSymbol={chartAssetSymbol} assetLabel={chartAssetLabel} />
                    <PerformanceChart candles={marketData.candles} portfolio={summary.portfolio} purchases={summary.purchases} />
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
                  <ShieldCheckIcon aria-hidden="true" className="size-4 text-profit" />
                  <h2 className="font-mono text-sm font-semibold text-profit">strategy details</h2>
                  <span className="font-mono text-xs text-muted-foreground">{"// vs buy and hold"}</span>
                </div>
                <div className="mt-4 grid gap-5 sm:grid-cols-3">
                  <div className="flex flex-col gap-2 border-border sm:border-r sm:pr-5">
                    <span className="font-mono text-xs text-muted-foreground">money-weighted annualized</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-24">
                      <span className={cn("font-mono text-3xl font-semibold", tileTone(summary.annualizedReturnPct ?? 0))}>
                        {summary.annualizedReturnPct === null ? (
                          "n/a"
                        ) : (
                          <CountUpValue
                            value={summary.annualizedReturnPct}
                            format={(value) => formatPercent(value, true)}
                            isPaused={isValueLoading}
                          />
                        )}
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">after all cash flows</span>
                  </div>
                  <div className="flex flex-col gap-2 border-border sm:border-r sm:pr-5">
                    <span className="font-mono text-xs text-muted-foreground">buy-and-hold value</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-32">
                      <span className="font-mono text-3xl font-semibold text-gold-400">
                        <CountUpValue value={summary.buyHoldValue} format={formatCurrency} isPaused={isValueLoading} />
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">same total invested</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-xs text-muted-foreground">buy-and-hold return</span>
                    <ValueSlot isLoading={isValueLoading} skeletonClassName="h-7 w-24">
                      <span className={cn("font-mono text-3xl font-semibold", tileTone(summary.buyHoldReturnPct))}>
                        <CountUpValue
                          value={summary.buyHoldReturnPct}
                          format={(value) => formatPercent(value, true)}
                          isPaused={isValueLoading}
                        />
                      </span>
                    </ValueSlot>
                    <span className="font-mono text-xs text-muted-foreground">over selected period</span>
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
                  {marketData?.note ??
                    "spy is the default asset. returns are price-only until dividend and adjustment data are added."}
                </p>
              </div>
            </section>
          </section>
        </div>

        <StatusLine isError={Boolean(error)} sourceLabel={sourceLabel} />
      </div>
    </main>
  )
}
