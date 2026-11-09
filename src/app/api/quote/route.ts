import { NextResponse } from "next/server";
import { searchTrustedAds, type TradeSide } from "@/lib/binance-p2p";
import {
  calculateQuote,
  pickAdsToCover,
  pickAdsToCoverByPyg,
  type QuoteMode,
} from "@/lib/calculator";
import {
  filterConfidentAds,
  parseConfidenceFromSearchParams,
} from "@/lib/confidence";

function parseSide(value: string | null): TradeSide {
  return value?.toUpperCase() === "BUY" ? "BUY" : "SELL";
}

function parseMode(value: string | null): QuoteMode {
  return value === "pyg_to_usdt" ? "pyg_to_usdt" : "usdt_to_pyg";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const amountRaw = searchParams.get("amount");
  const amount = Number(amountRaw);
  const side = parseSide(searchParams.get("side"));
  const mode = parseMode(searchParams.get("mode"));
  const trustedOnly = searchParams.get("trusted") !== "0";
  const filters = parseConfidenceFromSearchParams(searchParams);
  const selectedParam = searchParams.get("selected");
  const selectedIds = selectedParam
    ? selectedParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Query param `amount` must be a positive number." },
      { status: 400 },
    );
  }

  try {
    // Best bid = SELL book (merchants buying USDT → you get more PYG). Always higher than ask.
    const [ads, sellAds] = await Promise.all([
      searchTrustedAds({
        asset: "USDT",
        fiat: "PYG",
        tradeType: side,
        trustedOnly,
        pages: 3,
      }),
      side === "SELL"
        ? Promise.resolve(null)
        : searchTrustedAds({
            asset: "USDT",
            fiat: "PYG",
            tradeType: "SELL",
            trustedOnly,
            pages: 1,
          }),
    ]);

    if (ads.length === 0) {
      return NextResponse.json(
        {
          error:
            "No trusted merchant ads found for USDT/PYG right now. Try again shortly.",
          quote: null,
          ads: [],
        },
        { status: 404 },
      );
    }

    const confidentAds = filterConfidentAds(ads, filters);
    const pool = confidentAds.length > 0 ? confidentAds : ads;

    const bidSource = side === "SELL" ? ads : (sellAds ?? []);
    const confidentBid = filterConfidentAds(bidSource, filters);
    const bidPool = confidentBid.length > 0 ? confidentBid : bidSource;
    const topBid = bidPool[0] ?? null;
    const bestBid = topBid
      ? {
          advNo: topBid.advNo,
          price: topBid.price,
          nickName: topBid.nickName,
          minUsdt: topBid.minUsdt,
          maxUsdt: topBid.maxUsdt,
          minFiat: topBid.minFiat,
          maxFiat: topBid.maxFiat,
          paymentMethods: topBid.paymentMethods,
        }
      : null;

    const suggestedIds =
      mode === "pyg_to_usdt"
        ? pickAdsToCoverByPyg(pool, amount)
        : pickAdsToCover(pool, amount);
    const activeIds = selectedIds?.length ? selectedIds : suggestedIds;
    const activeSet = new Set(activeIds);
    const selectedAds = ads.filter((ad) => activeSet.has(ad.advNo));

    const quote = calculateQuote(selectedAds, { amount, mode, side });

    return NextResponse.json({
      pair: "USDT/PYG",
      trustedOnly,
      fetchedAt: new Date().toISOString(),
      filters,
      confidentCount: confidentAds.length,
      suggestedIds,
      selectedIds: activeIds,
      ads,
      quote,
      bestBid,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
