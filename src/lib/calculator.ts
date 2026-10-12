import type { P2PAd, TradeSide } from "./binance-p2p";

export type QuoteMode = "usdt_to_pyg" | "pyg_to_usdt";

export type QuoteRequest = {
  amount: number;
  mode: QuoteMode;
  /**
   * BUY = you pay PYG to buy USDT (sellers)
   * SELL = you sell USDT to receive PYG (buyers)
   */
  side: TradeSide;
};

export type FillLeg = {
  nickName: string;
  price: number;
  usdtFilled: number;
  pygFilled: number;
  paymentMethods: string[];
};

export type QuoteResult = {
  side: TradeSide;
  mode: QuoteMode;
  requestedAmount: number;
  bestPrice: number | null;
  avgFillPrice: number | null;
  usdt: number;
  pyg: number;
  filledFully: boolean;
  adsUsed: number;
  adsAvailable: number;
  fills: FillLeg[];
  topAds: Array<{
    nickName: string;
    price: number;
    minFiat: number;
    maxFiat: number;
    surplusAmount: number;
    monthOrderCount: number;
    monthFinishRate: number;
    paymentMethods: string[];
  }>;
};

function clampUsdtToAdLimits(ad: P2PAd, desiredUsdt: number): number | null {
  if (ad.surplusAmount <= 0 || ad.price <= 0) return null;

  let usdt = Math.min(desiredUsdt, ad.surplusAmount);
  let pyg = usdt * ad.price;

  if (ad.maxFiat > 0 && pyg > ad.maxFiat) {
    usdt = ad.maxFiat / ad.price;
    pyg = usdt * ad.price;
  }

  if (ad.minFiat > 0 && pyg < ad.minFiat) {
    return null;
  }

  if (usdt <= 0) return null;
  return usdt;
}

/**
 * Walk the trusted order book and fill as much of the request as possible.
 */
export function calculateQuote(
  ads: P2PAd[],
  request: QuoteRequest,
): QuoteResult {
  const { amount, mode, side } = request;
  const fills: FillLeg[] = [];
  let remainingUsdt =
    mode === "usdt_to_pyg" ? amount : Number.POSITIVE_INFINITY;
  let remainingPyg =
    mode === "pyg_to_usdt" ? amount : Number.POSITIVE_INFINITY;
  let totalUsdt = 0;
  let totalPyg = 0;

  for (const ad of ads) {
    if (remainingUsdt <= 1e-8 && remainingPyg <= 1e-2) break;

    const desiredUsdt =
      mode === "usdt_to_pyg"
        ? remainingUsdt
        : remainingPyg / ad.price;

    const usdtChunk = clampUsdtToAdLimits(ad, desiredUsdt);
    if (usdtChunk == null) continue;

    // For PYG input, don't overshoot remaining fiat by more than a rounding hair
    let finalUsdt = usdtChunk;
    let pygChunk = finalUsdt * ad.price;
    if (mode === "pyg_to_usdt" && pygChunk > remainingPyg) {
      finalUsdt = remainingPyg / ad.price;
      const reclamped = clampUsdtToAdLimits(ad, finalUsdt);
      if (reclamped == null) continue;
      finalUsdt = reclamped;
      pygChunk = finalUsdt * ad.price;
    }

    fills.push({
      nickName: ad.nickName,
      price: ad.price,
      usdtFilled: finalUsdt,
      pygFilled: pygChunk,
      paymentMethods: ad.paymentMethods,
    });

    totalUsdt += finalUsdt;
    totalPyg += pygChunk;
    remainingUsdt -= finalUsdt;
    remainingPyg -= pygChunk;
  }

  const filledFully =
    mode === "usdt_to_pyg"
      ? remainingUsdt <= Math.max(amount * 0.001, 0.01)
      : remainingPyg <= Math.max(amount * 0.001, 1);

  const avgFillPrice = totalUsdt > 0 ? totalPyg / totalUsdt : null;

  return {
    side,
    mode,
    requestedAmount: amount,
    bestPrice: ads[0]?.price ?? null,
    avgFillPrice,
    usdt: totalUsdt,
    pyg: totalPyg,
    filledFully,
    adsUsed: fills.length,
    adsAvailable: ads.length,
    fills,
    topAds: ads.slice(0, 8).map((ad) => ({
      nickName: ad.nickName,
      price: ad.price,
      minFiat: ad.minFiat,
      maxFiat: ad.maxFiat,
      surplusAmount: ad.surplusAmount,
      monthOrderCount: ad.monthOrderCount,
      monthFinishRate: ad.monthFinishRate,
      paymentMethods: ad.paymentMethods,
    })),
  };
}
