"use client"

import { useEffect, useRef } from "react"
import type { IChartApi, ISeriesMarkersPluginApi, LineData, SeriesMarker, Time } from "lightweight-charts"

import type { Candle, PortfolioPoint, Purchase } from "@/types/market"

const PRICE_COLOR = "#35d6e6"
const DCA_BUY_COLOR = "#72f25f"

type PerformanceChartProps = {
  candles: Candle[]
  portfolio: PortfolioPoint[]
  purchases: Purchase[]
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

export function PerformanceChart({ candles, portfolio, purchases }: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || candles.length === 0) {
      return
    }

    let chart: IChartApi | null = null
    let markerApi: ISeriesMarkersPluginApi<Time> | null = null
    let resizeObserver: ResizeObserver | null = null
    let disposed = false

    async function renderChart() {
      const { LineSeries, createChart, createSeriesMarkers } = await import("lightweight-charts")

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

      const assetReturnSeries = chart.addSeries(LineSeries, {
        priceScaleId: "left",
        color: PRICE_COLOR,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      })

      const portfolioSeries = chart.addSeries(LineSeries, {
        priceScaleId: "left",
        color: "#f8c159",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      })

      const firstClose = candles[0]?.close ?? 0
      const assetReturnData: LineData<Time>[] = candles.map((candle) => ({
        time: toChartTime(candle.time),
        value: toReturnPercent(candle.close, firstClose),
      }))

      assetReturnSeries.setData(assetReturnData)
      portfolioSeries.setData(
        portfolio
          .filter((point) => point.invested > 0)
          .map((point) => ({
            time: toChartTime(point.time),
            value: toReturnPercent(point.value, point.invested),
          }))
      )

      const markerStride = Math.max(1, Math.ceil(purchases.length / 42))
      const markers: SeriesMarker<Time>[] = purchases
        .filter((_, index) => index % markerStride === 0 || index === purchases.length - 1)
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
  }, [candles, portfolio, purchases])

  return <div ref={containerRef} className="h-[340px] w-full overflow-hidden rounded-lg border border-border md:h-[360px]" />
}
