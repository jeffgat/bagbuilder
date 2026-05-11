"use client"

import { useEffect, useRef } from "react"
import type { IChartApi, ISeriesMarkersPluginApi, LineData, SeriesMarker, Time } from "lightweight-charts"

import type { Candle, PortfolioPoint, Purchase } from "@/types/market"

type PerformanceChartProps = {
  candles: Candle[]
  portfolio: PortfolioPoint[]
  purchases: Purchase[]
}

function toChartTime(time: string) {
  return time as Time
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value)
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
          borderColor: "rgba(248,193,89,0.55)",
          visible: true,
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
          priceFormatter: (value: number) => compactCurrency(value),
        },
      })

      const assetPriceSeries = chart.addSeries(LineSeries, {
        priceScaleId: "left",
        color: "#72f25f",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      })

      const portfolioSeries = chart.addSeries(LineSeries, {
        priceScaleId: "right",
        color: "#f8c159",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      })

      const assetPriceData: LineData<Time>[] = candles.map((candle) => ({
        time: toChartTime(candle.time),
        value: candle.close,
      }))

      assetPriceSeries.setData(assetPriceData)
      portfolioSeries.setData(
        portfolio
          .filter((point) => point.value > 0)
          .map((point) => ({
            time: toChartTime(point.time),
            value: point.value,
          }))
      )

      const markerStride = Math.max(1, Math.ceil(purchases.length / 42))
      const markers: SeriesMarker<Time>[] = purchases
        .filter((_, index) => index % markerStride === 0 || index === purchases.length - 1)
        .map((purchase, index) => ({
          id: `${purchase.time}-${index}`,
          time: toChartTime(purchase.time),
          position: "atPriceTop",
          price: purchase.price,
          shape: "arrowDown",
          color: "#f8c159",
          size: 1.1,
        }))

      markerApi = createSeriesMarkers(assetPriceSeries, markers, {
        autoScale: true,
        zOrder: "top",
      })

      chart.priceScale("left").applyOptions({
        scaleMargins: { top: 0.16, bottom: 0.18 },
      })
      chart.priceScale("right").applyOptions({
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
