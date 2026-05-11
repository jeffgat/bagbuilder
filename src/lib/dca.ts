import { getFrequency } from "@/lib/assets"
import type { Candle, DcaSummary, Frequency, PortfolioPoint, Purchase } from "@/types/market"

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function addFrequency(date: Date, frequency: Frequency) {
  const next = new Date(date)

  if (frequency === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7)
    return next
  }

  if (frequency === "biweekly") {
    next.setUTCDate(next.getUTCDate() + 14)
    return next
  }

  if (frequency === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1)
    return next
  }

  if (frequency === "quarterly") {
    next.setUTCMonth(next.getUTCMonth() + 3)
    return next
  }

  next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}

function daysBetween(start: string, end: string) {
  const startDate = parseDate(start).getTime()
  const endDate = parseDate(end).getTime()
  return Math.max(1, (endDate - startDate) / 86_400_000)
}

function maxDrawdown(values: number[]) {
  let peak = 0
  let maxDrawdownPct = 0
  let maxDrawdownDollars = 0

  for (const value of values) {
    if (value <= 0) {
      continue
    }

    peak = Math.max(peak, value)
    if (peak > 0) {
      const drawdownDollars = value - peak
      const drawdownPct = drawdownDollars / peak

      if (drawdownPct < maxDrawdownPct) {
        maxDrawdownPct = drawdownPct
        maxDrawdownDollars = drawdownDollars
      }
    }
  }

  return {
    dollars: maxDrawdownDollars,
    percent: maxDrawdownPct * 100,
  }
}

function xirr(cashFlows: Array<{ time: string; amount: number }>) {
  if (cashFlows.length < 2) {
    return null
  }

  const firstDate = parseDate(cashFlows[0].time).getTime()
  const npv = (rate: number) =>
    cashFlows.reduce((total, flow) => {
      const years = (parseDate(flow.time).getTime() - firstDate) / (365 * 86_400_000)
      return total + flow.amount / (1 + rate) ** years
    }, 0)

  let low = -0.9999
  let high = 10
  let lowValue = npv(low)
  let highValue = npv(high)

  if (Number.isNaN(lowValue) || Number.isNaN(highValue) || lowValue * highValue > 0) {
    return null
  }

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2
    const midValue = npv(mid)

    if (Math.abs(midValue) < 0.00001) {
      return mid
    }

    if (lowValue * midValue <= 0) {
      high = mid
      highValue = midValue
    } else {
      low = mid
      lowValue = midValue
    }
  }

  return (low + high) / 2
}

export function calculateDca({
  candles,
  salary,
  investmentPercent,
  frequency,
}: {
  candles: Candle[]
  salary: number
  investmentPercent: number
  frequency: Frequency
}): DcaSummary {
  if (candles.length === 0) {
    return {
      totalInvested: 0,
      currentValue: 0,
      netReturnPct: 0,
      netReturnDollars: 0,
      maxDrawdownPct: 0,
      maxDrawdownDollars: 0,
      assetDrawdownPct: 0,
      totalPurchases: 0,
      averageBuyPrice: 0,
      totalShares: 0,
      latestPrice: 0,
      firstPrice: 0,
      years: 0,
      annualizedReturnPct: null,
      buyHoldReturnPct: 0,
      buyHoldValue: 0,
      amountPerPurchase: 0,
      purchases: [],
      portfolio: [],
    }
  }

  const sortedCandles = [...candles].sort((a, b) => a.time.localeCompare(b.time))
  const annualInvestment = salary * (investmentPercent / 100)
  const amountPerPurchase = annualInvestment / getFrequency(frequency).periodsPerYear
  const firstDate = parseDate(sortedCandles[0].time)
  const lastDate = parseDate(sortedCandles.at(-1)?.time ?? sortedCandles[0].time)
  const purchases: Purchase[] = []
  let scheduledDate = new Date(firstDate)
  let candleIndex = 0

  while (scheduledDate <= lastDate) {
    while (candleIndex < sortedCandles.length && parseDate(sortedCandles[candleIndex].time) < scheduledDate) {
      candleIndex += 1
    }

    const candle = sortedCandles[candleIndex]
    if (candle && amountPerPurchase > 0) {
      purchases.push({
        time: candle.time,
        price: candle.close,
        shares: amountPerPurchase / candle.close,
        amount: amountPerPurchase,
      })
      candleIndex += 1
    }

    scheduledDate = addFrequency(scheduledDate, frequency)
  }

  const purchaseByTime = new Map<string, Purchase[]>()
  for (const purchase of purchases) {
    const sameDayPurchases = purchaseByTime.get(purchase.time) ?? []
    sameDayPurchases.push(purchase)
    purchaseByTime.set(purchase.time, sameDayPurchases)
  }

  let shares = 0
  let invested = 0
  const portfolio: PortfolioPoint[] = []

  for (const candle of sortedCandles) {
    const todaysPurchases = purchaseByTime.get(candle.time) ?? []
    for (const purchase of todaysPurchases) {
      shares += purchase.shares
      invested += purchase.amount
    }

    portfolio.push({
      time: candle.time,
      value: shares * candle.close,
      invested,
    })
  }

  const latestPrice = sortedCandles.at(-1)?.close ?? 0
  const firstPrice = sortedCandles[0].close
  const currentValue = shares * latestPrice
  const totalInvested = purchases.reduce((total, purchase) => total + purchase.amount, 0)
  const netReturnDollars = currentValue - totalInvested
  const netReturnPct = totalInvested > 0 ? (netReturnDollars / totalInvested) * 100 : 0
  const averageBuyPrice = shares > 0 ? totalInvested / shares : 0
  const years = daysBetween(sortedCandles[0].time, sortedCandles.at(-1)?.time ?? sortedCandles[0].time) / 365
  const annualizedReturn = xirr([
    ...purchases.map((purchase) => ({ time: purchase.time, amount: -purchase.amount })),
    { time: sortedCandles.at(-1)?.time ?? sortedCandles[0].time, amount: currentValue },
  ])
  const buyHoldShares = firstPrice > 0 ? totalInvested / firstPrice : 0
  const buyHoldValue = buyHoldShares * latestPrice
  const buyHoldReturnPct = totalInvested > 0 ? ((buyHoldValue - totalInvested) / totalInvested) * 100 : 0
  const portfolioDrawdown = maxDrawdown(portfolio.map((point) => point.value))
  const assetDrawdown = maxDrawdown(sortedCandles.map((candle) => candle.close))

  return {
    totalInvested,
    currentValue,
    netReturnPct,
    netReturnDollars,
    maxDrawdownPct: portfolioDrawdown.percent,
    maxDrawdownDollars: portfolioDrawdown.dollars,
    assetDrawdownPct: assetDrawdown.percent,
    totalPurchases: purchases.length,
    averageBuyPrice,
    totalShares: shares,
    latestPrice,
    firstPrice,
    years,
    annualizedReturnPct: annualizedReturn === null ? null : annualizedReturn * 100,
    buyHoldReturnPct,
    buyHoldValue,
    amountPerPurchase,
    purchases,
    portfolio,
  }
}
