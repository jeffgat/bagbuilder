export type AssetSymbol = string

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly"

export type DataSource = "coingecko" | "coinmetrics" | "databento" | "demo"
export type DataAccess = "included" | "cost-capped" | "demo" | "free"
export type PriceAdjustmentSource = "databento-reference" | "price-gap-detection" | "none"

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type PriceAdjustmentEvent = {
  date: string
  factor: number
  source: Exclude<PriceAdjustmentSource, "none">
  description: string
}

export type Purchase = {
  time: string
  price: number
  shares: number
  amount: number
}

export type PortfolioPoint = {
  time: string
  value: number
  invested: number
}

export type MarketDataResponse = {
  symbol: AssetSymbol
  label: string
  name: string
  dataSymbol: string
  dataset: string
  schema: string
  source: DataSource
  note?: string
  estimatedCostUsd?: number | null
  costCapUsd?: number
  billing?: {
    access: DataAccess
    plan: string
    description: string
  }
  availability?: {
    months: number
    start: string | null
    end: string | null
  }
  adjustment?: {
    price: "raw" | "split-adjusted"
    source: PriceAdjustmentSource
    events: PriceAdjustmentEvent[]
  }
  range: {
    requestedMonths: number
    actualMonths: number
    start: string | null
    end: string | null
    isLimited: boolean
  }
  candles: Candle[]
}

export type DcaSummary = {
  totalInvested: number
  currentValue: number
  netReturnPct: number
  netReturnDollars: number
  maxDrawdownPct: number
  maxDrawdownDollars: number
  assetDrawdownPct: number
  totalPurchases: number
  averageBuyPrice: number
  totalShares: number
  latestPrice: number
  firstPrice: number
  assetReturnPct: number
  assetMoveDollars: number
  years: number
  annualizedReturnPct: number | null
  buyHoldReturnPct: number
  buyHoldValue: number
  fullMoveDollars: number
  moveCapturePct: number | null
  amountPerPurchase: number
  purchases: Purchase[]
  portfolio: PortfolioPoint[]
}
