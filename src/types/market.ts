export type AssetSymbol = string

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly"

export type DataSource = "databento" | "demo"

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
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
  years: number
  annualizedReturnPct: number | null
  buyHoldReturnPct: number
  buyHoldValue: number
  amountPerPurchase: number
  purchases: Purchase[]
  portfolio: PortfolioPoint[]
}
