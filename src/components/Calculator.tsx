"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

type QuoteResponse = {
  pair: string;
  trustedOnly: boolean;
  fetchedAt: string;
  quote: {
    side: "BUY" | "SELL";
    mode: "usdt_to_pyg" | "pyg_to_usdt";
    requestedAmount: number;
    bestPrice: number | null;
    avgFillPrice: number | null;
    usdt: number;
    pyg: number;
    filledFully: boolean;
    adsUsed: number;
    adsAvailable: number;
    fills: Array<{
      nickName: string;
      price: number;
      usdtFilled: number;
      pygFilled: number;
      paymentMethods: string[];
    }>;
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
  error?: string;
};

function formatPyg(n: number) {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatUsdt(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export default function Calculator() {
  const [side, setSide] = useState<"SELL" | "BUY">("SELL");
  const [mode, setMode] = useState<"usdt_to_pyg" | "pyg_to_usdt">(
    "usdt_to_pyg",
  );
  const [amount, setAmount] = useState("100");
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runQuote = useCallback(() => {
    const parsed = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive amount.");
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const params = new URLSearchParams({
          amount: String(parsed),
          side,
          mode,
          trusted: "1",
        });
        const res = await fetch(`/api/quote?${params.toString()}`);
        const json = (await res.json()) as QuoteResponse & { error?: string };
        if (!res.ok) {
          setData(null);
          setError(json.error || "Could not fetch quote.");
          return;
        }
        setData(json);
      } catch {
        setError("Network error talking to Binance P2P.");
        setData(null);
      }
    });
  }, [amount, mode, side]);

  useEffect(() => {
    runQuote();
    // Initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quote = data?.quote;

  return (
    <div className="w-full max-w-xl">
      <form
        className="calc-panel"
        onSubmit={(e) => {
          e.preventDefault();
          runQuote();
        }}
      >
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            type="button"
            className={`chip ${side === "SELL" ? "chip-active" : ""}`}
            onClick={() => {
              setSide("SELL");
              setMode("usdt_to_pyg");
            }}
          >
            Sell USDT → get PYG
          </button>
          <button
            type="button"
            className={`chip ${side === "BUY" ? "chip-active" : ""}`}
            onClick={() => {
              setSide("BUY");
              setMode("pyg_to_usdt");
            }}
          >
            Spend PYG → buy USDT
          </button>
        </div>

        <label className="block text-sm text-[var(--muted)] mb-2">
          {mode === "usdt_to_pyg" ? "USDT amount" : "PYG amount"}
        </label>
        <div className="flex gap-3 items-stretch">
          <input
            className="amount-input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
          />
          <button type="submit" className="cta" disabled={isPending}>
            {isPending ? "Quoting…" : "Calculate"}
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          Trusted merchants only · live Binance P2P USDT/PYG
        </p>
      </form>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {quote && !error && (
        <section className="result-block mt-8" aria-live="polite">
          <p className="result-label">You get</p>
          <p className="result-value">
            {mode === "usdt_to_pyg"
              ? formatPyg(quote.pyg)
              : `${formatUsdt(quote.usdt)} USDT`}
          </p>
          <p className="result-sub">
            {mode === "usdt_to_pyg"
              ? `for ${formatUsdt(quote.usdt)} USDT`
              : `for ${formatPyg(quote.pyg)}`}
            {quote.avgFillPrice != null && (
              <>
                {" "}
                · avg {formatPyg(quote.avgFillPrice)} / USDT
              </>
            )}
            {quote.bestPrice != null && (
              <> · best {formatPyg(quote.bestPrice)}</>
            )}
          </p>
          {!quote.filledFully && (
            <p className="mt-2 text-sm text-[var(--warn)]">
              Partial fill across available trusted ads (
              {quote.adsUsed}/{quote.adsAvailable}).
            </p>
          )}

          {quote.topAds.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium tracking-wide uppercase text-[var(--muted)] mb-3">
                Trusted offers
              </h2>
              <ul className="offer-list">
                {quote.topAds.map((ad) => (
                  <li key={`${ad.nickName}-${ad.price}-${ad.maxFiat}`}>
                    <div className="flex justify-between gap-4">
                      <span className="font-medium">{ad.nickName}</span>
                      <span className="tabular-nums">
                        {formatPyg(ad.price)}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        Limit {formatPyg(ad.minFiat)} – {formatPyg(ad.maxFiat)}
                      </span>
                      <span>{formatUsdt(ad.surplusAmount)} USDT avail.</span>
                      <span>
                        {ad.monthOrderCount} orders ·{" "}
                        {(ad.monthFinishRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
