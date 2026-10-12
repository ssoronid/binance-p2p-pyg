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
  advNo: string;
  nickName: string;
  price: number;
  usdtFilled: number;
  pygFilled: number;
  paymentMethods: string[];
  monthOrderCount: number;
  monthFinishRate: number;
  positiveRate: number;
};

export type QuoteResult = {
  side: TradeSide;
  mode: QuoteMode;
  requestedAmount: number;
  targetUsdt: number;
  targetPyg: number | null;
  remainingUsdt: number;
  remainingPyg: number;
  bestPrice: number | null;
  avgFillPrice: number | null;
  usdt: number;
  pyg: number;
  filledFully: boolean;
  coveragePct: number;
  adsUsed: number;
  adsAvailable: number;
  fills: FillLeg[];
};

function clampUsdtToAdLimits(ad: P2PAd, desiredUsdt: number): number | null {
  if (ad.surplusAmount <= 0 || ad.price <= 0) return null;

  const hardCap = Math.min(
    ad.surplusAmount,
    ad.tradableQuantity || ad.surplusAmount,
    ad.maxUsdt || ad.surplusAmount,
  );

  let usdt = Math.min(desiredUsdt, hardCap);
  let pyg = usdt * ad.price;

  if (ad.maxFiat > 0 && pyg > ad.maxFiat) {
    usdt = ad.maxFiat / ad.price;
    pyg = usdt * ad.price;
  }

  if (ad.minUsdt > 0 && usdt < ad.minUsdt) {
    return null;
  }

  if (ad.minFiat > 0 && pyg < ad.minFiat) {
    return null;
  }

  if (usdt <= 0) return null;
  return usdt;
}

/**
 * Walk selected ads (already sorted by preference) and fill the request.
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

  const estimateUsdt =
    mode === "usdt_to_pyg"
      ? amount
      : ads[0]
        ? amount / ads[0].price
        : 0;

  for (const ad of ads) {
    if (mode === "usdt_to_pyg" && remainingUsdt <= 1e-8) break;
    if (mode === "pyg_to_usdt" && remainingPyg <= 1e-2) break;

    const desiredUsdt =
      mode === "usdt_to_pyg" ? remainingUsdt : remainingPyg / ad.price;

    const usdtChunk = clampUsdtToAdLimits(ad, desiredUsdt);
    if (usdtChunk == null) continue;

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
      advNo: ad.advNo,
      nickName: ad.nickName,
      price: ad.price,
      usdtFilled: finalUsdt,
      pygFilled: pygChunk,
      paymentMethods: ad.paymentMethods,
      monthOrderCount: ad.monthOrderCount,
      monthFinishRate: ad.monthFinishRate,
      positiveRate: ad.positiveRate,
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

  const coveragePct =
    mode === "usdt_to_pyg"
      ? amount > 0
        ? Math.min(100, (totalUsdt / amount) * 100)
        : 0
      : amount > 0
        ? Math.min(100, (totalPyg / amount) * 100)
        : 0;

  const remUsdt =
    remainingUsdt === Number.POSITIVE_INFINITY ? 0 : Math.max(remainingUsdt, 0);
  const remPyg =
    remainingPyg === Number.POSITIVE_INFINITY ? 0 : Math.max(remainingPyg, 0);

  return {
    side,
    mode,
    requestedAmount: amount,
    targetUsdt: mode === "usdt_to_pyg" ? amount : totalUsdt || estimateUsdt,
    targetPyg: mode === "pyg_to_usdt" ? amount : null,
    remainingUsdt: remUsdt,
    remainingPyg: remPyg,
    bestPrice: ads[0]?.price ?? null,
    avgFillPrice,
    usdt: totalUsdt,
    pyg: totalPyg,
    filledFully,
    coveragePct,
    adsUsed: fills.length,
    adsAvailable: ads.length,
    fills,
  };
}

/**
 * Greedily pick ads until a USDT target is covered.
 */
export function pickAdsToCover(
  ads: P2PAd[],
  usdtTarget: number,
): string[] {
  const selected: string[] = [];
  let remaining = usdtTarget;

  for (const ad of ads) {
    if (remaining <= 0.01) break;
    const chunk = clampUsdtToAdLimits(ad, remaining);
    if (chunk == null) continue;
    selected.push(ad.advNo);
    remaining -= chunk;
  }

  if (selected.length === 0) {
    return ads.slice(0, Math.min(5, ads.length)).map((a) => a.advNo);
  }

  return selected;
}

/**
 * Greedily pick ads until a PYG target is covered (e.g. need ₲16.200.000).
 */
export function pickAdsToCoverByPyg(
  ads: P2PAd[],
  pygTarget: number,
): string[] {
  const selected: string[] = [];
  let remaining = pygTarget;

  for (const ad of ads) {
    if (remaining <= 1) break;
    const desiredUsdt = remaining / ad.price;
    const chunk = clampUsdtToAdLimits(ad, desiredUsdt);
    if (chunk == null) continue;

    let usdt = chunk;
    let pyg = usdt * ad.price;
    if (pyg > remaining) {
      usdt = remaining / ad.price;
      const reclamped = clampUsdtToAdLimits(ad, usdt);
      if (reclamped == null) continue;
      usdt = reclamped;
      pyg = usdt * ad.price;
    }

    selected.push(ad.advNo);
    remaining -= pyg;
  }

  if (selected.length === 0) {
    return ads.slice(0, Math.min(5, ads.length)).map((a) => a.advNo);
  }

  return selected;
}

/** Max USDT this ad can take in one trade given its limits. */
export function maxUsdtForAd(ad: P2PAd): number {
  const hardCap = Math.min(
    ad.surplusAmount,
    ad.tradableQuantity || ad.surplusAmount,
    ad.maxUsdt || ad.surplusAmount,
  );
  if (ad.maxFiat > 0 && ad.price > 0) {
    return Math.min(hardCap, ad.maxFiat / ad.price);
  }
  return hardCap;
}

/** Parse amounts like 16.200.000, 16,200,000, or 16200000. */
export function parseAmountInput(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "");
  if (!cleaned) return NaN;

  if (/^\d{1,3}([.]\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, ""));
  }
  if (/^\d{1,3}([,]\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/,/g, ""));
  }
  if (/^\d{1,3}([.]\d{3})+,\d+$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}([,]\d{3})+.\d+$/.test(cleaned)) {
    return Number(cleaned.replace(/,/g, ""));
  }

  return Number(cleaned.replace(/,/g, ""));
}
