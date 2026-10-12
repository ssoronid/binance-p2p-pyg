const SEARCH_URL =
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

export type TradeSide = "BUY" | "SELL";

export type P2PAd = {
  advNo: string;
  price: number;
  surplusAmount: number;
  minFiat: number;
  maxFiat: number;
  nickName: string;
  monthOrderCount: number;
  monthFinishRate: number;
  userType: string;
  isMerchant: boolean;
  paymentMethods: string[];
};

type BinanceAdvRow = {
  adv?: {
    advNo?: string;
    price?: string;
    surplusAmount?: string;
    minSingleTransAmount?: string;
    maxSingleTransAmount?: string;
    tradeMethods?: Array<{ tradeMethodName?: string }>;
  };
  advertiser?: {
    nickName?: string;
    monthOrderCount?: number;
    monthFinishRate?: number;
    userType?: string;
  };
};

export type SearchAdsOptions = {
  asset?: string;
  fiat?: string;
  /** From the user's perspective: BUY crypto or SELL crypto */
  tradeType: TradeSide;
  pages?: number;
  rows?: number;
  /** Only verified merchants ("Trusted" on Binance UI) */
  trustedOnly?: boolean;
};

async function fetchPage(
  body: Record<string, unknown>,
): Promise<BinanceAdvRow[]> {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://p2p.binance.com",
      Referer: "https://p2p.binance.com/en/trade/all-payments/USDT?fiat=PYG",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Binance P2P search failed (${res.status})`);
  }

  const json = (await res.json()) as {
    code?: string;
    message?: string;
    data?: BinanceAdvRow[] | null;
  };

  if (json.code && json.code !== "000000") {
    throw new Error(json.message || `Binance error ${json.code}`);
  }

  return Array.isArray(json.data) ? json.data : [];
}

function mapRow(row: BinanceAdvRow): P2PAd | null {
  const adv = row.adv;
  const advertiser = row.advertiser;
  if (!adv?.price || !adv.advNo) return null;

  const price = Number(adv.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    advNo: adv.advNo,
    price,
    surplusAmount: Number(adv.surplusAmount ?? 0),
    minFiat: Number(adv.minSingleTransAmount ?? 0),
    maxFiat: Number(adv.maxSingleTransAmount ?? 0),
    nickName: advertiser?.nickName ?? "Unknown",
    monthOrderCount: advertiser?.monthOrderCount ?? 0,
    monthFinishRate: advertiser?.monthFinishRate ?? 0,
    userType: advertiser?.userType ?? "user",
    isMerchant:
      (advertiser?.userType ?? "").toLowerCase() === "merchant",
    paymentMethods: (adv.tradeMethods ?? [])
      .map((m) => m.tradeMethodName)
      .filter((n): n is string => Boolean(n)),
  };
}

/**
 * Search Binance P2P ads. With trustedOnly (default true), uses
 * publisherType=merchant — Binance's Verified / Trusted merchant filter.
 */
export async function searchTrustedAds(
  options: SearchAdsOptions,
): Promise<P2PAd[]> {
  const {
    asset = "USDT",
    fiat = "PYG",
    tradeType,
    pages = 2,
    rows = 20,
    trustedOnly = true,
  } = options;

  const ads: P2PAd[] = [];

  for (let page = 1; page <= pages; page += 1) {
    const body: Record<string, unknown> = {
      asset,
      fiat,
      tradeType,
      page,
      rows,
      payTypes: [],
      countries: [],
      proMerchantAds: false,
      shieldMerchantAds: false,
      filterType: "all",
      periods: [],
      additionalKycVerifyFilter: 0,
    };

    if (trustedOnly) {
      body.publisherType = "merchant";
    }

    const rowsData = await fetchPage(body);
    if (rowsData.length === 0) break;

    for (const row of rowsData) {
      const mapped = mapRow(row);
      if (mapped) ads.push(mapped);
    }

    if (rowsData.length < rows) break;
  }

  // BUY = buy USDT → ascending price (cheapest sellers first)
  // SELL = sell USDT → descending price (highest buyers first)
  ads.sort((a, b) =>
    tradeType === "BUY" ? a.price - b.price : b.price - a.price,
  );

  return ads;
}
