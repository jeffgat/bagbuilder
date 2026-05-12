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
  leverage = 1,
  maintenanceMarginPercent = 25,
}: {
  candles: Candle[]
  salary: number
  investmentPercent: number
  frequency: Frequency
  leverage?: number
  maintenanceMarginPercent?: number
}): DcaSummary {
  const normalizedLeverage = Math.max(1, leverage)
  const maintenanceMarginRate = Math.max(0, maintenanceMarginPercent) / 100

  if (candles.length === 0) {
    return {
      totalInvested: 0,
      grossExposure: 0,
      marginDebt: 0,
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
      assetReturnPct: 0,
      assetMoveDollars: 0,
      years: 0,
      annualizedReturnPct: null,
      buyHoldReturnPct: 0,
      buyHoldValue: 0,
      fullMoveDollars: 0,
      moveCapturePct: null,
      amountPerPurchase: 0,
      grossAmountPerPurchase: 0,
      borrowedAmountPerPurchase: 0,
      leverage: normalizedLeverage,
      isLiquidated: false,
      liquidationDate: null,
      liquidationPrice: null,
      purchases: [],
      portfolio: [],
    }
  }

  const sortedCandles = [...candles].sort((a, b) => a.time.localeCompare(b.time))
  const annualInvestment = salary * (investmentPercent / 100)
  const amountPerPurchase = annualInvestment / getFrequency(frequency).periodsPerYear
  const grossAmountPerPurchase = amountPerPurchase * normalizedLeverage
  const borrowedAmountPerPurchase = grossAmountPerPurchase - amountPerPurchase
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
        shares: grossAmountPerPurchase / candle.close,
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
  let grossExposure = 0
  let marginDebt = 0
  let liquidationDate: string | null = null
  let liquidationPrice: number | null = null
  const portfolio: PortfolioPoint[] = []

  for (const candle of sortedCandles) {
    const todaysPurchases = purchaseByTime.get(candle.time) ?? []
    for (const purchase of todaysPurchases) {
      shares += purchase.shares
      invested += purchase.amount
      grossExposure += purchase.amount * normalizedLeverage
      marginDebt += purchase.amount * (normalizedLeverage - 1)
    }

    const grossValue = shares * candle.close
    const equityValue = grossValue - marginDebt
    const maintenanceRequirement = grossValue * maintenanceMarginRate

    if (
      liquidationDate === null &&
      marginDebt > 0 &&
      grossValue > 0 &&
      equityValue + 0.0001 < maintenanceRequirement
    ) {
      liquidationDate = candle.time
      liquidationPrice = candle.close
    }

    portfolio.push({
      time: candle.time,
      value: equityValue,
      invested,
    })
  }

  const latestPrice = sortedCandles.at(-1)?.close ?? 0
  const firstPrice = sortedCandles[0].close
  const assetMoveDollars = latestPrice - firstPrice
  const assetReturnPct = firstPrice > 0 ? (assetMoveDollars / firstPrice) * 100 : 0
  const currentValue = shares * latestPrice - marginDebt
  const totalInvested = purchases.reduce((total, purchase) => total + purchase.amount, 0)
  const netReturnDollars = currentValue - totalInvested
  const netReturnPct = totalInvested > 0 ? (netReturnDollars / totalInvested) * 100 : 0
  const averageBuyPrice = shares > 0 ? grossExposure / shares : 0
  const years = daysBetween(sortedCandles[0].time, sortedCandles.at(-1)?.time ?? sortedCandles[0].time) / 365
  const annualizedReturn = xirr([
    ...purchases.map((purchase) => ({ time: purchase.time, amount: -purchase.amount })),
    { time: sortedCandles.at(-1)?.time ?? sortedCandles[0].time, amount: currentValue },
  ])
  const buyHoldShares = firstPrice > 0 ? totalInvested / firstPrice : 0
  const buyHoldValue = buyHoldShares * latestPrice
  const buyHoldReturnPct = totalInvested > 0 ? ((buyHoldValue - totalInvested) / totalInvested) * 100 : 0
  const fullMoveDollars = buyHoldValue - totalInvested
  const moveCapturePct = fullMoveDollars !== 0 ? (netReturnDollars / fullMoveDollars) * 100 : null
  const portfolioDrawdown = maxDrawdown(portfolio.map((point) => point.value))
  const assetDrawdown = maxDrawdown(sortedCandles.map((candle) => candle.close))

  return {
    totalInvested,
    grossExposure,
    marginDebt,
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
    assetReturnPct,
    assetMoveDollars,
    years,
    annualizedReturnPct: annualizedReturn === null ? null : annualizedReturn * 100,
    buyHoldReturnPct,
    buyHoldValue,
    fullMoveDollars,
    moveCapturePct,
    amountPerPurchase,
    grossAmountPerPurchase,
    borrowedAmountPerPurchase,
    leverage: normalizedLeverage,
    isLiquidated: liquidationDate !== null,
    liquidationDate,
    liquidationPrice,
    purchases,
    portfolio,
  }
}
