"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import type { P2PAd } from "@/lib/binance-p2p";
import {
  calculateQuote,
  maxUsdtForAd,
  pickAdsToCover,
  type QuoteMode,
  type QuoteResult,
} from "@/lib/calculator";

type AdsResponse = {
  pair: string;
  trustedOnly: boolean;
  fetchedAt: string;
  suggestedIds: string[];
  selectedIds: string[];
  ads: P2PAd[];
  quote: QuoteResult;
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

function formatPct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatActive(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function identityLabel(id: string) {
  if (!id) return "Merchant";
  return id
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default function Calculator() {
  const [side, setSide] = useState<"SELL" | "BUY">("SELL");
  const [mode, setMode] = useState<QuoteMode>("usdt_to_pyg");
  const [amount, setAmount] = useState("100");
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsedAmount = useMemo(() => {
    const n = Number(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const usdtTarget = useMemo(() => {
    if (!parsedAmount) return 0;
    if (mode === "usdt_to_pyg") return parsedAmount;
    const best = ads[0]?.price;
    return best ? parsedAmount / best : 0;
  }, [parsedAmount, mode, ads]);

  const selectedAds = useMemo(
    () => ads.filter((ad) => selected.has(ad.advNo)),
    [ads, selected],
  );

  const quote = useMemo(() => {
    if (!parsedAmount || selectedAds.length === 0) return null;
    return calculateQuote(selectedAds, {
      amount: parsedAmount,
      mode,
      side,
    });
  }, [parsedAmount, selectedAds, mode, side]);

  const fillByAdv = useMemo(() => {
    const map = new Map<string, QuoteResult["fills"][number]>();
    quote?.fills.forEach((f) => map.set(f.advNo, f));
    return map;
  }, [quote]);

  const loadAds = useCallback(() => {
    if (!parsedAmount) {
      setError("Enter a positive amount.");
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const params = new URLSearchParams({
          amount: String(parsedAmount),
          side,
          mode,
          trusted: "1",
        });
        const res = await fetch(`/api/quote?${params.toString()}`);
        const json = (await res.json()) as AdsResponse & { error?: string };
        if (!res.ok) {
          setAds([]);
          setSelected(new Set());
          setError(json.error || "Could not fetch merchants.");
          return;
        }
        setAds(json.ads);
        setFetchedAt(json.fetchedAt);
        setSelected(new Set(json.suggestedIds));
      } catch {
        setError("Network error talking to Binance P2P.");
        setAds([]);
        setSelected(new Set());
      }
    });
  }, [parsedAmount, mode, side]);

  useEffect(() => {
    loadAds();
    // Initial + when side changes we refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  function toggleAd(advNo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(advNo)) next.delete(advNo);
      else next.add(advNo);
      return next;
    });
  }

  function selectSuggested() {
    setSelected(new Set(pickAdsToCover(ads, usdtTarget)));
  }

  function selectAll() {
    setSelected(new Set(ads.map((a) => a.advNo)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  return (
    <div className="w-full max-w-3xl">
      <form
        className="calc-panel"
        onSubmit={(e) => {
          e.preventDefault();
          loadAds();
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
          {mode === "usdt_to_pyg" ? "USDT amount needed" : "PYG amount"}
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
            {isPending ? "Loading…" : "Refresh"}
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          Trusted merchants only · tick/untick to mix until your USDT is covered
          {fetchedAt && (
            <> · updated {new Date(fetchedAt).toLocaleTimeString()}</>
          )}
        </p>
      </form>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {quote && (
        <section className="result-block mt-6" aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="result-label">Mixed quote</p>
              <p className="result-value">
                {mode === "usdt_to_pyg"
                  ? formatPyg(quote.pyg)
                  : `${formatUsdt(quote.usdt)} USDT`}
              </p>
              <p className="result-sub">
                {formatUsdt(quote.usdt)} / {formatUsdt(usdtTarget)} USDT covered
                {quote.avgFillPrice != null && (
                  <> · avg {formatPyg(quote.avgFillPrice)} / USDT</>
                )}
                {" · "}
                {quote.adsUsed} merchant{quote.adsUsed === 1 ? "" : "s"}
              </p>
            </div>
            <div className="coverage min-w-[10rem]">
              <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                <span>Coverage</span>
                <span>{quote.coveragePct.toFixed(0)}%</span>
              </div>
              <div className="coverage-bar">
                <div
                  className={`coverage-fill ${quote.filledFully ? "ok" : "warn"}`}
                  style={{ width: `${Math.min(100, quote.coveragePct)}%` }}
                />
              </div>
              {!quote.filledFully && (
                <p className="mt-1 text-xs text-[var(--warn)]">
                  Still need {formatUsdt(quote.remainingUsdt)} USDT — select
                  another merchant
                </p>
              )}
            </div>
          </div>

          {quote.fills.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="result-label mb-2">Fill plan</p>
              <ul className="fill-plan">
                {quote.fills.map((f) => (
                  <li key={f.advNo}>
                    <span className="font-medium">{f.nickName}</span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      {formatUsdt(f.usdtFilled)} USDT → {formatPyg(f.pygFilled)}{" "}
                      @ {formatPyg(f.price)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {ads.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium tracking-wide uppercase text-[var(--muted)]">
              Merchants ({selected.size}/{ads.length} selected)
            </h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="chip" onClick={selectSuggested}>
                Auto-cover
              </button>
              <button type="button" className="chip" onClick={selectAll}>
                All
              </button>
              <button type="button" className="chip" onClick={clearAll}>
                None
              </button>
            </div>
          </div>

          <ul className="merchant-list">
            {ads.map((ad) => {
              const checked = selected.has(ad.advNo);
              const fill = fillByAdv.get(ad.advNo);
              const maxUsdt = maxUsdtForAd(ad);
              const lowConfidence =
                ad.monthFinishRate < 0.9 ||
                ad.positiveRate < 0.95 ||
                ad.monthOrderCount < 20;

              return (
                <li
                  key={ad.advNo}
                  className={`merchant-row ${checked ? "selected" : ""} ${fill ? "in-fill" : ""} ${lowConfidence ? "caution" : ""}`}
                >
                  <label className="merchant-label">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAd(ad.advNo)}
                      className="merchant-check"
                    />
                    <div className="merchant-body">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-base">
                            {ad.nickName}
                          </span>
                          {lowConfidence && (
                            <span className="badge warn">Low confidence</span>
                          )}
                          {ad.badges.map((b) => (
                            <span key={b} className="badge">
                              {b}
                            </span>
                          ))}
                          {ad.userIdentity && (
                            <span className="badge muted">
                              {identityLabel(ad.userIdentity)}
                            </span>
                          )}
                        </div>
                        <span className="tabular-nums text-lg font-medium">
                          {formatPyg(ad.price)}
                        </span>
                      </div>

                      <div className="stats-grid">
                        <span>
                          <strong>{ad.monthOrderCount}</strong> ops / mo
                        </span>
                        <span>
                          <strong>{formatPct(ad.monthFinishRate)}</strong>{" "}
                          completion
                        </span>
                        <span>
                          <strong>{formatPct(ad.positiveRate)}</strong> positive
                        </span>
                        <span>
                          Grade <strong>{ad.userGrade}</strong>
                          {ad.vipLevel > 0 ? ` · VIP ${ad.vipLevel}` : ""}
                        </span>
                        <span>
                          Avail <strong>{formatUsdt(ad.surplusAmount)}</strong>{" "}
                          USDT
                        </span>
                        <span>
                          Max trade <strong>{formatUsdt(maxUsdt)}</strong> USDT
                        </span>
                        <span>
                          Limit {formatPyg(ad.minFiat)} – {formatPyg(ad.maxFiat)}
                        </span>
                        <span>
                          Pay window{" "}
                          <strong>
                            {ad.payTimeLimitMin
                              ? `${ad.payTimeLimitMin}m`
                              : "—"}
                          </strong>
                        </span>
                        <span>
                          Active <strong>{formatActive(ad.activeTimeInSecond)}</strong>
                        </span>
                      </div>

                      <div className="text-xs text-[var(--muted)] mt-2 flex flex-wrap gap-x-2 gap-y-1">
                        {ad.paymentMethods.map((p) => (
                          <span key={p} className="pay-chip">
                            {p}
                          </span>
                        ))}
                      </div>

                      {fill && (
                        <p className="fill-hint mt-2">
                          Using {formatUsdt(fill.usdtFilled)} USDT →{" "}
                          {formatPyg(fill.pygFilled)} in the mix
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
