import type { AssetSymbol, Frequency } from "@/types/market"

type Asset = {
  symbol: AssetSymbol
  name: string
  label: string
  description: string
  dataSymbol: string
  dataset: string
  datasetCandidates: string[]
  schema: string
  kind: "stock" | "etf" | "crypto"
  coinGeckoId?: string
  coinMetricsId?: string
  marketCapRank?: number
  searchAliases?: string[]
  note?: string
}

const EQUITY_DATASET = "EQUS.MINI"
const NASDAQ_HISTORY_DATASET = "XNAS.ITCH"
const NYSE_HISTORY_DATASET = "XNYS.PILLAR"
const NYSE_ARCA_HISTORY_DATASET = "ARCX.PILLAR"
const DAILY_SCHEMA = "ohlcv-1d"
const COINGECKO_DATASET = "coingecko"
const COINGECKO_SCHEMA = "market_chart/range"
const COINMETRICS_DATASET = "coinmetrics-community"
const COINMETRICS_SCHEMA = "PriceUSD-1d"
const RECENT_AGGREGATED_DATASETS = ["EQUS.MINI", "EQUS.SUMMARY", "XNAS.BASIC"]

const NASDAQ_LISTED_SYMBOLS = new Set([
  "AAPL",
  "ADI",
  "AMD",
  "AMAT",
  "AMGN",
  "AMZN",
  "APP",
  "ARM",
  "ASML",
  "AVGO",
  "AZN",
  "COST",
  "CSCO",
  "COIN",
  "CRWD",
  "CRWV",
  "GILD",
  "GOOG",
  "HOOD",
  "IBIT",
  "INTC",
  "KLAC",
  "LRCX",
  "META",
  "MRVL",
  "MSFT",
  "MU",
  "NFLX",
  "NVDA",
  "PANW",
  "PEP",
  "PLTR",
  "QQQ",
  "QCOM",
  "SNDK",
  "STX",
  "TMUS",
  "TSLA",
  "TXN",
  "WDC",
])

const NYSE_ARCA_LISTED_SYMBOLS = new Set(["GLD", "IVV", "SPY", "VOO"])

function uniqueDatasets(datasets: string[]) {
  return Array.from(new Set(datasets))
}

function longHistoryDatasets(dataSymbol: string) {
  const primaryDataset = NASDAQ_LISTED_SYMBOLS.has(dataSymbol)
    ? NASDAQ_HISTORY_DATASET
    : NYSE_ARCA_LISTED_SYMBOLS.has(dataSymbol)
    ? NYSE_ARCA_HISTORY_DATASET
    : NYSE_HISTORY_DATASET

  return uniqueDatasets([
    primaryDataset,
    ...RECENT_AGGREGATED_DATASETS,
  ])
}

function stockAsset(dataSymbol: string, name: string, marketCapRank: number, searchAliases?: string[]): Asset {
  return {
    symbol: dataSymbol,
    name,
    label: `${dataSymbol} - ${name}`,
    description: "top 100 u.s.-listed stock by market cap.",
    dataSymbol,
    dataset: EQUITY_DATASET,
    datasetCandidates: longHistoryDatasets(dataSymbol),
    schema: DAILY_SCHEMA,
    kind: "stock",
    marketCapRank,
    searchAliases,
  }
}

function watchlistStockAsset(dataSymbol: string, name: string, searchAliases?: string[]): Asset {
  return {
    symbol: dataSymbol,
    name,
    label: `${dataSymbol} - ${name}`,
    description: "u.s.-listed stock from the watchlist.",
    dataSymbol,
    dataset: EQUITY_DATASET,
    datasetCandidates: longHistoryDatasets(dataSymbol),
    schema: DAILY_SCHEMA,
    kind: "stock",
    searchAliases,
  }
}

function cryptoAsset({
  coinGeckoId,
  coinMetricsId,
  marketCapRank,
  name,
  symbol,
  searchAliases,
}: {
  coinGeckoId: string
  coinMetricsId?: string
  marketCapRank: number
  name: string
  symbol: string
  searchAliases: string[]
}): Asset {
  return {
    symbol,
    name,
    label: `${symbol} - ${name}`,
    description: `spot crypto price history from ${coinMetricsId ? "coin metrics" : "coingecko"}.`,
    dataSymbol: symbol,
    dataset: coinMetricsId ? COINMETRICS_DATASET : COINGECKO_DATASET,
    datasetCandidates: [coinMetricsId ? COINMETRICS_DATASET : COINGECKO_DATASET],
    schema: coinMetricsId ? COINMETRICS_SCHEMA : COINGECKO_SCHEMA,
    kind: "crypto",
    coinGeckoId,
    coinMetricsId,
    marketCapRank,
    searchAliases,
    note: `${name.toLowerCase()} spot price history is sourced from ${coinMetricsId ? "coin metrics community PriceUSD" : "coingecko"}. prices are usd market data and do not include exchange fees, taxes, spreads, staking yield, or custody costs.`,
  }
}

const STARTER_ASSETS: Asset[] = [
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    label: "SPY - SPDR S&P 500 ETF",
    description: "starter s&p 500 proxy with deep history and tight etf liquidity.",
    dataSymbol: "SPY",
    dataset: NYSE_ARCA_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("SPY"),
    schema: DAILY_SCHEMA,
    kind: "etf",
  },
  {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    label: "VOO - Vanguard S&P 500 ETF",
    description: "lower-fee etf alternative for later comparisons.",
    dataSymbol: "VOO",
    dataset: NYSE_ARCA_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("VOO"),
    schema: DAILY_SCHEMA,
    kind: "etf",
  },
  {
    symbol: "IVV",
    name: "iShares Core S&P 500 ETF",
    label: "IVV - iShares Core S&P 500 ETF",
    description: "another large s&p 500 etf proxy.",
    dataSymbol: "IVV",
    dataset: NYSE_ARCA_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("IVV"),
    schema: DAILY_SCHEMA,
    kind: "etf",
  },
  {
    symbol: "NASDAQ",
    name: "Invesco QQQ ETF",
    label: "QQQ - Invesco QQQ ETF",
    description: "nasdaq-100 exposure through the liquid qqq etf proxy.",
    dataSymbol: "QQQ",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("QQQ"),
    schema: DAILY_SCHEMA,
    kind: "etf",
    note: "nasdaq exposure is represented by qqq, an exchange-traded nasdaq-100 proxy.",
  },
  {
    symbol: "GOLD",
    name: "SPDR Gold Shares ETF",
    label: "GLD - SPDR Gold Shares ETF",
    description: "gold price exposure through the gld etf proxy.",
    dataSymbol: "GLD",
    dataset: NYSE_ARCA_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("GLD"),
    schema: DAILY_SCHEMA,
    kind: "etf",
    note: "gold exposure is represented by gld, an exchange-traded gold proxy.",
  },
  {
    symbol: "BITCOIN",
    name: "iShares Bitcoin Trust ETF",
    label: "IBIT - iShares Bitcoin Trust ETF",
    description: "bitcoin spot etf exposure through the ibit proxy.",
    dataSymbol: "IBIT",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("IBIT"),
    schema: DAILY_SCHEMA,
    kind: "etf",
    note: "bitcoin exposure is represented by ibit, an exchange-traded spot bitcoin etf proxy with data from its 2024 launch onward.",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    label: "NVDA - NVIDIA Corp.",
    description: "semiconductor and ai infrastructure bellwether.",
    dataSymbol: "NVDA",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("NVDA"),
    schema: DAILY_SCHEMA,
    kind: "stock",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    label: "TSLA - Tesla Inc.",
    description: "electric vehicle and energy storage growth stock.",
    dataSymbol: "TSLA",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("TSLA"),
    schema: DAILY_SCHEMA,
    kind: "stock",
  },
  {
    symbol: "GOOG",
    name: "Alphabet Inc.",
    label: "GOOG - Alphabet Inc.",
    description: "alphabet class c stock for search, ads, cloud, and ai exposure.",
    dataSymbol: "GOOG",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("GOOG"),
    schema: DAILY_SCHEMA,
    kind: "stock",
    searchAliases: ["GOOGL"],
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    label: "AAPL - Apple Inc.",
    description: "consumer hardware, services, and platform ecosystem leader.",
    dataSymbol: "AAPL",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("AAPL"),
    schema: DAILY_SCHEMA,
    kind: "stock",
  },
  {
    symbol: "META",
    name: "Meta Platforms Inc.",
    label: "META - Meta Platforms Inc.",
    description: "social platforms, advertising, ai, and metaverse exposure.",
    dataSymbol: "META",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("META"),
    schema: DAILY_SCHEMA,
    kind: "stock",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc.",
    label: "AMZN - Amazon.com Inc.",
    description: "e-commerce, aws cloud, advertising, and logistics exposure.",
    dataSymbol: "AMZN",
    dataset: NASDAQ_HISTORY_DATASET,
    datasetCandidates: longHistoryDatasets("AMZN"),
    schema: DAILY_SCHEMA,
    kind: "stock",
  },
]

const TOP_CRYPTO_ASSETS: Asset[] = [
  cryptoAsset({
    symbol: "BTC",
    name: "Bitcoin",
    coinGeckoId: "bitcoin",
    coinMetricsId: "btc",
    marketCapRank: 1,
    searchAliases: ["bitcoin"],
  }),
  cryptoAsset({
    symbol: "ETH",
    name: "Ethereum",
    coinGeckoId: "ethereum",
    coinMetricsId: "eth",
    marketCapRank: 2,
    searchAliases: ["ether", "ethereum"],
  }),
  cryptoAsset({
    symbol: "USDT",
    name: "Tether",
    coinGeckoId: "tether",
    coinMetricsId: "usdt",
    marketCapRank: 3,
    searchAliases: ["tether"],
  }),
  cryptoAsset({
    symbol: "XRP",
    name: "XRP",
    coinGeckoId: "ripple",
    coinMetricsId: "xrp",
    marketCapRank: 4,
    searchAliases: ["ripple"],
  }),
  cryptoAsset({
    symbol: "BNB",
    name: "BNB",
    coinGeckoId: "binancecoin",
    coinMetricsId: "bnb",
    marketCapRank: 5,
    searchAliases: ["binance coin", "bnb"],
  }),
  cryptoAsset({
    symbol: "USDC",
    name: "USDC",
    coinGeckoId: "usd-coin",
    coinMetricsId: "usdc",
    marketCapRank: 6,
    searchAliases: ["usd coin"],
  }),
  cryptoAsset({
    symbol: "SOL",
    name: "Solana",
    coinGeckoId: "solana",
    marketCapRank: 7,
    searchAliases: ["solana"],
  }),
  cryptoAsset({
    symbol: "TRX",
    name: "TRON",
    coinGeckoId: "tron",
    coinMetricsId: "trx",
    marketCapRank: 8,
    searchAliases: ["tron"],
  }),
  cryptoAsset({
    symbol: "FIGR_HELOC",
    name: "Figure Heloc",
    coinGeckoId: "figure-heloc",
    marketCapRank: 9,
    searchAliases: ["figure heloc", "figure"],
  }),
  cryptoAsset({
    symbol: "DOGE",
    name: "Dogecoin",
    coinGeckoId: "dogecoin",
    coinMetricsId: "doge",
    marketCapRank: 10,
    searchAliases: ["doge", "dogecoin"],
  }),
]

const TOP_MARKET_CAP_ASSETS: Asset[] = [
  stockAsset("NVDA", "NVIDIA Corporation", 1),
  stockAsset("GOOG", "Alphabet Inc.", 2, ["GOOGL"]),
  stockAsset("AAPL", "Apple Inc.", 3),
  stockAsset("MSFT", "Microsoft Corporation", 4),
  stockAsset("AMZN", "Amazon.com, Inc.", 5),
  stockAsset("AVGO", "Broadcom Inc.", 6),
  stockAsset("TSM", "Taiwan Semiconductor Manufacturing Company Limited", 7),
  stockAsset("TSLA", "Tesla, Inc.", 8),
  stockAsset("META", "Meta Platforms, Inc.", 9),
  stockAsset("BRK.B", "Berkshire Hathaway Inc.", 10),
  stockAsset("WMT", "Walmart Inc.", 11),
  stockAsset("MU", "Micron Technology, Inc.", 12),
  stockAsset("LLY", "Eli Lilly and Company", 13),
  stockAsset("JPM", "JPMorgan Chase & Co.", 14),
  stockAsset("AMD", "Advanced Micro Devices, Inc.", 15),
  stockAsset("INTC", "Intel Corporation", 16),
  stockAsset("XOM", "Exxon Mobil Corporation", 17),
  stockAsset("V", "Visa Inc.", 18),
  stockAsset("ASML", "ASML Holding N.V.", 19),
  stockAsset("ORCL", "Oracle Corporation", 20),
  stockAsset("JNJ", "Johnson & Johnson", 21),
  stockAsset("MA", "Mastercard Incorporated", 22),
  stockAsset("COST", "Costco Wholesale Corporation", 23),
  stockAsset("CAT", "Caterpillar Inc.", 24),
  stockAsset("CSCO", "Cisco Systems, Inc.", 25),
  stockAsset("LRCX", "Lam Research Corporation", 26),
  stockAsset("CVX", "Chevron Corporation", 27),
  stockAsset("NFLX", "Netflix, Inc.", 28),
  stockAsset("ABBV", "AbbVie Inc.", 29),
  stockAsset("BAC", "Bank of America Corporation", 30),
  stockAsset("AMAT", "Applied Materials, Inc.", 31),
  stockAsset("UNH", "UnitedHealth Group Incorporated", 32),
  stockAsset("KO", "The Coca-Cola Company", 33),
  stockAsset("PG", "The Procter & Gamble Company", 34),
  stockAsset("PLTR", "Palantir Technologies Inc.", 35),
  stockAsset("GE", "GE Aerospace", 36),
  stockAsset("BABA", "Alibaba Group Holding Limited", 37),
  stockAsset("HD", "The Home Depot, Inc.", 38),
  stockAsset("HSBC", "HSBC Holdings plc", 39),
  stockAsset("MS", "Morgan Stanley", 40),
  stockAsset("GEV", "GE Vernova Inc.", 41),
  stockAsset("GS", "The Goldman Sachs Group, Inc.", 42),
  stockAsset("AZN", "AstraZeneca PLC", 43),
  stockAsset("PM", "Philip Morris International Inc.", 44),
  stockAsset("NVS", "Novartis AG", 45),
  stockAsset("MRK", "Merck & Co., Inc.", 46),
  stockAsset("TXN", "Texas Instruments Incorporated", 47),
  stockAsset("QCOM", "QUALCOMM Incorporated", 48),
  stockAsset("RY", "Royal Bank of Canada", 49),
  stockAsset("KLAC", "KLA Corporation", 50),
  stockAsset("RTX", "RTX Corporation", 51),
  stockAsset("TM", "Toyota Motor Corporation", 52),
  stockAsset("SHEL", "Shell plc", 53),
  stockAsset("SNDK", "Sandisk Corporation", 54),
  stockAsset("LIN", "Linde plc", 55),
  stockAsset("ARM", "Arm Holdings plc", 56),
  stockAsset("WFC", "Wells Fargo & Company", 57),
  stockAsset("C", "Citigroup Inc.", 58),
  stockAsset("BHP", "BHP Group Limited", 59),
  stockAsset("AXP", "American Express Company", 60),
  stockAsset("IBM", "International Business Machines Corporation", 61),
  stockAsset("TMUS", "T-Mobile US, Inc.", 62),
  stockAsset("MUFG", "Mitsubishi UFJ Financial Group, Inc.", 63),
  stockAsset("PEP", "PepsiCo, Inc.", 64),
  stockAsset("ADI", "Analog Devices, Inc.", 65),
  stockAsset("NVO", "Novo Nordisk A/S", 66),
  stockAsset("SAP", "SAP SE", 67),
  stockAsset("NEE", "NextEra Energy, Inc.", 68),
  stockAsset("VZ", "Verizon Communications Inc.", 69),
  stockAsset("MCD", "McDonald's Corporation", 70),
  stockAsset("TTE", "TotalEnergies SE", 71),
  stockAsset("BA", "The Boeing Company", 72),
  stockAsset("STX", "Seagate Technology Holdings plc", 73),
  stockAsset("DIS", "The Walt Disney Company", 74),
  stockAsset("RIO", "Rio Tinto Group", 75),
  stockAsset("TD", "The Toronto-Dominion Bank", 76),
  stockAsset("GLW", "Corning Incorporated", 77),
  stockAsset("WDC", "Western Digital Corporation", 78),
  stockAsset("AMGN", "Amgen Inc.", 79),
  stockAsset("SAN", "Banco Santander, S.A.", 80),
  stockAsset("BLK", "BlackRock, Inc.", 81),
  stockAsset("ANET", "Arista Networks, Inc.", 82),
  stockAsset("T", "AT&T Inc.", 83),
  stockAsset("PANW", "Palo Alto Networks, Inc.", 84),
  stockAsset("TMO", "Thermo Fisher Scientific Inc.", 85),
  stockAsset("GILD", "Gilead Sciences, Inc.", 86),
  stockAsset("TJX", "The TJX Companies, Inc.", 87),
  stockAsset("DELL", "Dell Technologies Inc.", 88),
  stockAsset("ETN", "Eaton Corporation plc", 89),
  stockAsset("UNP", "Union Pacific Corporation", 90),
  stockAsset("DE", "Deere & Company", 91),
  stockAsset("BUD", "Anheuser-Busch InBev SA/NV", 92),
  stockAsset("UBER", "Uber Technologies, Inc.", 93),
  stockAsset("APP", "AppLovin Corporation", 94),
  stockAsset("SCCO", "Southern Copper Corporation", 95),
  stockAsset("APH", "Amphenol Corporation", 96),
  stockAsset("SCHW", "The Charles Schwab Corporation", 97),
  stockAsset("WELL", "Welltower Inc.", 98),
  stockAsset("BX", "Blackstone Inc.", 99),
  stockAsset("MRVL", "Marvell Technology, Inc.", 100),
]

const WATCHLIST_ASSETS: Asset[] = [
  watchlistStockAsset("HOOD", "Robinhood Markets, Inc.", ["robinhood"]),
  watchlistStockAsset("MO", "Altria Group, Inc.", ["altria"]),
  watchlistStockAsset("FCX", "Freeport-McMoRan Inc.", ["freeport", "freeport mcmoran"]),
  watchlistStockAsset("COIN", "Coinbase Global, Inc.", ["coinbase"]),
  watchlistStockAsset("CRWD", "CrowdStrike Holdings, Inc.", ["crowdstrike"]),
  watchlistStockAsset("CRWV", "CoreWeave, Inc.", ["coreweave"]),
]

const featuredDataSymbols = new Set([...STARTER_ASSETS, ...TOP_CRYPTO_ASSETS, ...WATCHLIST_ASSETS].map((asset) => asset.dataSymbol))
const topAssetsByDataSymbol = new Map(TOP_MARKET_CAP_ASSETS.map((asset) => [asset.dataSymbol, asset]))

export const ASSETS: Asset[] = [
  ...STARTER_ASSETS.map((asset) => ({
    ...asset,
    marketCapRank: topAssetsByDataSymbol.get(asset.dataSymbol)?.marketCapRank,
  })),
  ...TOP_CRYPTO_ASSETS,
  ...WATCHLIST_ASSETS,
  ...TOP_MARKET_CAP_ASSETS.filter((asset) => !featuredDataSymbols.has(asset.dataSymbol)),
]

export const FREQUENCIES: Array<{
  value: Frequency
  label: string
  periodsPerYear: number
  cadenceLabel: string
}> = [
  { value: "weekly", label: "weekly", periodsPerYear: 52, cadenceLabel: "52 buys/year" },
  { value: "biweekly", label: "biweekly", periodsPerYear: 26, cadenceLabel: "26 buys/year" },
  { value: "monthly", label: "monthly", periodsPerYear: 12, cadenceLabel: "12 buys/year" },
  { value: "quarterly", label: "quarterly", periodsPerYear: 4, cadenceLabel: "4 buys/year" },
  { value: "yearly", label: "yearly", periodsPerYear: 1, cadenceLabel: "1 buy/year" },
]

export function getAsset(symbol: string) {
  const normalizedSymbol = symbol.toUpperCase()

  return (
    ASSETS.find(
      (asset) => asset.symbol.toUpperCase() === normalizedSymbol || asset.dataSymbol.toUpperCase() === normalizedSymbol
    ) ?? ASSETS[0]
  )
}

export function getFrequency(value: Frequency) {
  return FREQUENCIES.find((frequency) => frequency.value === value) ?? FREQUENCIES[2]
}
