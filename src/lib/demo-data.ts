import type { AssetSymbol, Candle } from "@/types/market"

const START_PRICE_BY_SYMBOL: Partial<Record<AssetSymbol, number>> = {
  SPY: 392,
  VOO: 360,
  IVV: 405,
  NASDAQ: 326,
  GOLD: 174,
  BITCOIN: 28,
  NVDA: 28,
  TSLA: 204,
  GOOG: 95,
  AAPL: 152,
  META: 124,
  AMZN: 92,
}

function symbolSeed(symbol: AssetSymbol) {
  return Array.from(symbol).reduce((total, character, index) => total + character.charCodeAt(0) * (index + 1), 0)
}

function getDemoStartPrice(symbol: AssetSymbol) {
  return START_PRICE_BY_SYMBOL[symbol] ?? 65 + (symbolSeed(symbol) % 220)
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isWeekday(date: Date) {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

function seededNoise(index: number, symbol: AssetSymbol) {
  const symbolOffset = symbolSeed(symbol)
  return Math.sin(index * 0.17 + symbolOffset) * 0.009 + Math.sin(index * 0.037) * 0.004
}

export function generateDemoCandles(symbol: AssetSymbol, months: number): Candle[] {
  const end = new Date()
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()))
  const candles: Candle[] = []
  let price = getDemoStartPrice(symbol)
  let tradingDay = 0

  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (!isWeekday(date)) {
      continue
    }

    const longWave = Math.sin(tradingDay / 44) * 0.004
    const drift = 0.00036
    const drawdownShock =
      tradingDay > 140 && tradingDay < 195 ? -0.0028 : tradingDay > 360 && tradingDay < 410 ? -0.0018 : 0
    const dailyReturn = drift + longWave + seededNoise(tradingDay, symbol) + drawdownShock
    const open = price
    price = Math.max(12, price * (1 + dailyReturn))
    const close = price
    const high = Math.max(open, close) * (1 + Math.abs(seededNoise(tradingDay + 11, symbol)) * 1.2)
    const low = Math.min(open, close) * (1 - Math.abs(seededNoise(tradingDay + 23, symbol)) * 1.1)

    candles.push({
      time: formatDate(date),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(62_000_000 + Math.abs(seededNoise(tradingDay + 7, symbol)) * 5_900_000_000),
    })

    tradingDay += 1
  }

  return candles
}
