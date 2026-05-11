import type { Candle, PriceAdjustmentEvent } from "@/types/market"

const COMMON_SPLIT_FACTORS = [
  0.01,
  0.02,
  0.025,
  0.04,
  0.05,
  0.0666666667,
  0.1,
  0.125,
  0.1428571429,
  0.2,
  0.25,
  0.3333333333,
  0.5,
  2,
  3,
  4,
  5,
  7,
  8,
  10,
  15,
  20,
  25,
  40,
  50,
  100,
]

function roundPrice(value: number) {
  return Number(value.toFixed(6))
}

function roundVolume(value: number) {
  return Math.max(0, Math.round(value))
}

function relativeDistance(value: number, target: number) {
  return Math.abs(value - target) / Math.abs(target)
}

function findLikelySplitFactor(observedFactor: number) {
  if (!Number.isFinite(observedFactor) || observedFactor <= 0) {
    return null
  }

  if (observedFactor > 0.55 && observedFactor < 1.8) {
    return null
  }

  const nearest = COMMON_SPLIT_FACTORS.reduce(
    (best, factor) => {
      const distance = relativeDistance(observedFactor, factor)

      return distance < best.distance ? { factor, distance } : best
    },
    { factor: 1, distance: Number.POSITIVE_INFINITY }
  )

  return nearest.distance <= 0.07 ? nearest.factor : null
}

function describeSplitFactor(factor: number) {
  if (factor < 1) {
    const ratio = Math.round(1 / factor)

    return Number.isFinite(ratio) ? `${ratio}-for-1 forward split` : "forward split"
  }

  return `${Math.round(factor)}-for-1 reverse split`
}

export function detectSplitAdjustments(candles: Candle[]): PriceAdjustmentEvent[] {
  const sortedCandles = [...candles].sort((a, b) => a.time.localeCompare(b.time))
  const events: PriceAdjustmentEvent[] = []

  for (let index = 1; index < sortedCandles.length; index += 1) {
    const previous = sortedCandles[index - 1]
    const current = sortedCandles[index]

    if (previous.close <= 0 || current.open <= 0 || current.close <= 0) {
      continue
    }

    const splitFactor = findLikelySplitFactor(current.open / previous.close)

    if (!splitFactor) {
      continue
    }

    const adjustedPreviousClose = previous.close * splitFactor
    const currentDayMidpoint = (current.open + current.close) / 2
    const closeContinuity = relativeDistance(adjustedPreviousClose, currentDayMidpoint)

    if (closeContinuity > 0.12) {
      continue
    }

    events.push({
      date: current.time,
      factor: splitFactor,
      source: "price-gap-detection",
      description: `${describeSplitFactor(splitFactor)} detected from raw ohlcv price gap`,
    })
  }

  return events
}

export function applyPriceAdjustments(candles: Candle[], events: PriceAdjustmentEvent[]) {
  if (events.length === 0) {
    return candles
  }

  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date))

  return candles.map((candle) => {
    const factor = sortedEvents.reduce(
      (cumulativeFactor, event) => (candle.time < event.date ? cumulativeFactor * event.factor : cumulativeFactor),
      1
    )

    if (factor === 1) {
      return candle
    }

    return {
      ...candle,
      open: roundPrice(candle.open * factor),
      high: roundPrice(candle.high * factor),
      low: roundPrice(candle.low * factor),
      close: roundPrice(candle.close * factor),
      volume: factor > 0 ? roundVolume(candle.volume / factor) : candle.volume,
    }
  })
}
