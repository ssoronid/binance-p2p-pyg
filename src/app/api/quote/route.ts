import { NextResponse } from "next/server";
import { searchTrustedAds, type TradeSide } from "@/lib/binance-p2p";
import {
  calculateQuote,
  pickAdsToCover,
  type QuoteMode,
} from "@/lib/calculator";

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
    const ads = await searchTrustedAds({
      asset: "USDT",
      fiat: "PYG",
      tradeType: side,
      trustedOnly,
      pages: 3,
    });

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

    const usdtTarget =
      mode === "usdt_to_pyg" ? amount : amount / (ads[0]?.price || 1);

    const suggestedIds = pickAdsToCover(ads, usdtTarget);
    const activeIds = selectedIds?.length ? selectedIds : suggestedIds;
    const activeSet = new Set(activeIds);
    const selectedAds = ads.filter((ad) => activeSet.has(ad.advNo));

    const quote = calculateQuote(selectedAds, { amount, mode, side });

    return NextResponse.json({
      pair: "USDT/PYG",
      trustedOnly,
      fetchedAt: new Date().toISOString(),
      suggestedIds,
      selectedIds: activeIds,
      ads,
      quote,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
