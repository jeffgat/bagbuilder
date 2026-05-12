"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { IChartApi, ISeriesMarkersPluginApi, LineData, SeriesMarker, Time } from "lightweight-charts"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Candle, PortfolioPoint, Purchase } from "@/types/market"

const PRICE_COLOR = "#35d6e6"
const DCA_BUY_COLOR = "#72f25f"
const BASE_NET_RETURN_COLOR = "#f8c159"
const CHART_INTERVALS = ["daily", "weekly", "monthly"] as const

type ChartInterval = (typeof CHART_INTERVALS)[number]

export type PerformanceComparisonSeries = {
  id: string
  label: string
  name: string
  color: string
  candles: Candle[]
  portfolio: PortfolioPoint[]
  purchases?: Purchase[]
  isSelected?: boolean
}

type PerformanceChartProps = {
  basePortfolio?: PortfolioPoint[]
  candles?: Candle[]
  comparisonAssets?: PerformanceComparisonSeries[]
  netReturnColor?: string
  portfolio?: PortfolioPoint[]
  purchases?: Purchase[]
}

function toChartTime(time: string) {
  return time as Time
}

function formatReturnPercent(value: number) {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
    minimumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value)

  return `${value > 0 ? "+" : ""}${formatted}%`
}

function toReturnPercent(current: number, basis: number) {
  if (basis <= 0) {
    return 0
  }

  return ((current - basis) / basis) * 100
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "")

  if (normalized.length !== 6) {
    return hex
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function parseChartDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function formatChartDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getIntervalKey(time: string, interval: ChartInterval) {
  if (interval === "daily") {
    return time
  }

  if (interval === "monthly") {
    return time.slice(0, 7)
  }

  const date = parseChartDate(time)
  const day = date.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)

  return formatChartDate(date)
}

function aggregateCandles(candles: Candle[], interval: ChartInterval) {
  if (interval === "daily") {
    return candles
  }

  const groups = new Map<string, Candle>()

  for (const candle of candles) {
    const key = getIntervalKey(candle.time, interval)
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, { ...candle })
      continue
    }

    existing.high = Math.max(existing.high, candle.high)
    existing.low = Math.min(existing.low, candle.low)
    existing.close = candle.close
    existing.time = candle.time
    existing.volume += candle.volume
  }

  return Array.from(groups.values())
}

function aggregatePortfolio(portfolio: PortfolioPoint[], interval: ChartInterval) {
  if (interval === "daily") {
    return portfolio
  }

  const groups = new Map<string, PortfolioPoint>()

  for (const point of portfolio) {
    groups.set(getIntervalKey(point.time, interval), point)
  }

  return Array.from(groups.values())
}

function aggregatePurchases({
  purchases,
  interval,
  intervalTimeByKey,
}: {
  purchases: Purchase[]
  interval: ChartInterval
  intervalTimeByKey: Map<string, string>
}) {
  if (interval === "daily") {
    return purchases
  }

  const groups = new Map<string, Purchase>()

  for (const purchase of purchases) {
    const key = getIntervalKey(purchase.time, interval)
    const chartTime = intervalTimeByKey.get(key)

    if (!chartTime) {
      continue
    }

    const existing = groups.get(key)
    groups.set(key, {
      time: chartTime,
      price: purchase.price,
      shares: (existing?.shares ?? 0) + purchase.shares,
      amount: (existing?.amount ?? 0) + purchase.amount,
    })
  }

  return Array.from(groups.values())
}

export function PerformanceChart({
  basePortfolio = [],
  candles = [],
  comparisonAssets,
  netReturnColor = BASE_NET_RETURN_COLOR,
  portfolio = [],
  purchases = [],
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [interval, setInterval] = useState<ChartInterval>("daily")
  const isComparisonMode = Boolean(comparisonAssets)
  const chartBasePortfolio = useMemo(() => aggregatePortfolio(basePortfolio, interval), [basePortfolio, interval])
  const chartSeries = useMemo(
    () =>
      (comparisonAssets?.length
        ? comparisonAssets
        : [
            {
              id: "single-asset",
              label: "asset",
              name: "selected asset",
              color: netReturnColor,
              candles,
              portfolio,
              purchases,
              isSelected: true,
            },
          ]
      ).map((series) => {
        const chartCandles = aggregateCandles(series.candles, interval)
        const intervalTimeByKey = new Map(chartCandles.map((candle) => [getIntervalKey(candle.time, interval), candle.time]))
        const chartPortfolio = aggregatePortfolio(series.portfolio, interval)
        const chartPurchases = aggregatePurchases({
          interval,
          intervalTimeByKey,
          purchases: series.purchases ?? [],
        })

        return {
          ...series,
          chartCandles,
          chartPortfolio,
          chartPurchases,
        }
      }),
    [candles, comparisonAssets, interval, netReturnColor, portfolio, purchases]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || chartSeries.every((series) => series.chartCandles.length === 0)) {
      return
    }

    let chart: IChartApi | null = null
    let markerApi: ISeriesMarkersPluginApi<Time> | null = null
    let resizeObserver: ResizeObserver | null = null
    let disposed = false

    async function renderChart() {
      const { LineSeries, LineStyle, createChart, createSeriesMarkers } = await import("lightweight-charts")

      if (disposed || !container) {
        return
      }

      chart = createChart(container, {
        autoSize: true,
        layout: {
          background: { color: "#050909" },
          textColor: "#a1adab",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(29,52,52,0.76)" },
          horzLines: { color: "rgba(29,52,52,0.72)" },
        },
        crosshair: {
          mode: 1,
          vertLine: { color: "rgba(114,242,95,0.36)" },
          horzLine: { color: "rgba(114,242,95,0.36)" },
        },
        rightPriceScale: {
          visible: false,
        },
        leftPriceScale: {
          borderColor: "rgba(29,52,52,0.95)",
          visible: true,
        },
        timeScale: {
          borderColor: "rgba(29,52,52,0.95)",
          timeVisible: false,
        },
        localization: {
          priceFormatter: (value: number) => formatReturnPercent(value),
        },
      })

      for (const series of chartSeries) {
        const firstClose = series.candles[0]?.close ?? series.chartCandles[0]?.close ?? 0
        const assetReturnSeries = chart.addSeries(LineSeries, {
          priceScaleId: "left",
          color: isComparisonMode ? hexToRgba(series.color, 0.3) : PRICE_COLOR,
          lineStyle: isComparisonMode ? LineStyle.Dashed : LineStyle.Solid,
          lineWidth: isComparisonMode ? 1 : 2,
          priceLineVisible: !isComparisonMode,
          lastValueVisible: !isComparisonMode,
        })

        const portfolioSeries = chart.addSeries(LineSeries, {
          priceScaleId: "left",
          color: series.color,
          lineWidth: series.isSelected ? 3 : 2,
          priceLineVisible: false,
          lastValueVisible: true,
        })

        const assetReturnData: LineData<Time>[] = series.chartCandles.map((candle) => ({
          time: toChartTime(candle.time),
          value: toReturnPercent(candle.close, firstClose),
        }))

        assetReturnSeries.setData(assetReturnData)
        portfolioSeries.setData(
          series.chartPortfolio
            .filter((point) => point.invested > 0)
            .map((point) => ({
              time: toChartTime(point.time),
              value: toReturnPercent(point.value, point.invested),
            }))
        )

        if (!isComparisonMode && chartBasePortfolio.length > 0) {
          const basePortfolioSeries = chart.addSeries(LineSeries, {
            priceScaleId: "left",
            color: BASE_NET_RETURN_COLOR,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
          })

          basePortfolioSeries.setData(
            chartBasePortfolio
              .filter((point) => point.invested > 0)
              .map((point) => ({
                time: toChartTime(point.time),
                value: toReturnPercent(point.value, point.invested),
              }))
          )
        }

        if (!isComparisonMode) {
          const markerStride = Math.max(1, Math.ceil(series.chartPurchases.length / 42))
          const markers: SeriesMarker<Time>[] = series.chartPurchases
            .filter((_, index) => index % markerStride === 0 || index === series.chartPurchases.length - 1)
            .map((purchase, index) => ({
              id: `${purchase.time}-${index}`,
              time: toChartTime(purchase.time),
              position: "atPriceTop",
              price: toReturnPercent(purchase.price, firstClose),
              shape: "arrowDown",
              color: DCA_BUY_COLOR,
              size: 1.1,
            }))

          markerApi = createSeriesMarkers(assetReturnSeries, markers, {
            autoScale: true,
            zOrder: "top",
          })
        }
      }

      chart.priceScale("left").applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.22 },
      })
      chart.timeScale().fitContent()

      resizeObserver = new ResizeObserver(() => {
        chart?.timeScale().fitContent()
      })
      resizeObserver.observe(container)
    }

    void renderChart()

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      markerApi?.detach()
      chart?.remove()
    }
  }, [chartBasePortfolio, chartSeries, isComparisonMode])

  return (
    <div className="relative h-[340px] w-full overflow-hidden rounded-lg border border-border md:h-[360px]">
      <div ref={containerRef} className="size-full" />
      <div
        aria-label="chart candle interval"
        role="group"
        className="absolute right-2 top-2 z-10 flex rounded-md border border-info/25 bg-bg-secondary/90 p-0.5 shadow-lg shadow-black/25 backdrop-blur"
      >
        {CHART_INTERVALS.map((item) => {
          const isSelected = item === interval

          return (
            <Button
              key={item}
              aria-pressed={isSelected}
              className={cn(
                "h-7 rounded-[0.35rem] px-2 font-mono text-xs",
                isSelected
                  ? "border-profit/30 bg-profit/15 text-profit hover:bg-profit/20"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-info/10 hover:text-info"
              )}
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => setInterval(item)}
            >
              {item}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
