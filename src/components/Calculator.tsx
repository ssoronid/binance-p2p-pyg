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
import {
  CONFIDENCE_PRESETS,
  DEFAULT_CONFIDENCE,
  confidenceFailReasons,
  describeFailReasons,
  filterConfidentAds,
  matchPreset,
  passesConfidence,
  type ConfidenceFilters,
  type ConfidencePreset,
} from "@/lib/confidence";

type AdsResponse = {
  pair: string;
  trustedOnly: boolean;
  fetchedAt: string;
  suggestedIds: string[];
  selectedIds: string[];
  ads: P2PAd[];
  quote: QuoteResult;
  confidentCount?: number;
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

function filtersToParams(filters: ConfidenceFilters): URLSearchParams {
  const p = new URLSearchParams();
  const preset = matchPreset(filters);
  if (preset) p.set("preset", preset);
  p.set("minTrades", String(filters.minMonthlyTrades));
  p.set("minCompletion", String(filters.minCompletionRate));
  p.set("minPositive", String(filters.minPositiveRate));
  p.set("minGrade", String(filters.minUserGrade));
  p.set("maxActive", String(filters.maxActiveSeconds));
  p.set("massOnly", filters.massMerchantOnly ? "1" : "0");
  return p;
}

export default function Calculator() {
  const [side, setSide] = useState<"SELL" | "BUY">("SELL");
  const [mode, setMode] = useState<QuoteMode>("usdt_to_pyg");
  const [amount, setAmount] = useState("100");
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ConfidenceFilters>(DEFAULT_CONFIDENCE);
  const [showExcluded, setShowExcluded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activePreset = matchPreset(filters);

  const parsedAmount = useMemo(() => {
    const n = Number(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const confidentAds = useMemo(
    () => filterConfidentAds(ads, filters),
    [ads, filters],
  );

  const usdtTarget = useMemo(() => {
    if (!parsedAmount) return 0;
    if (mode === "usdt_to_pyg") return parsedAmount;
    const best = confidentAds[0]?.price ?? ads[0]?.price;
    return best ? parsedAmount / best : 0;
  }, [parsedAmount, mode, ads, confidentAds]);

  const visibleAds = useMemo(
    () => (showExcluded ? ads : confidentAds),
    [ads, confidentAds, showExcluded],
  );

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

  const applyAutoCover = useCallback(
    (pool: P2PAd[], target: number) => {
      const source = pool.length > 0 ? pool : ads;
      setSelected(new Set(pickAdsToCover(source, target)));
    },
    [ads],
  );

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
        filtersToParams(filters).forEach((v, k) => params.set(k, v));

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
  }, [parsedAmount, mode, side, filters]);

  useEffect(() => {
    loadAds();
    // Initial + when side changes we refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  // Re-run auto-cover when confidence filters change (client-side, no refetch)
  useEffect(() => {
    if (ads.length === 0 || !usdtTarget) return;
    applyAutoCover(confidentAds, usdtTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function toggleAd(advNo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(advNo)) next.delete(advNo);
      else next.add(advNo);
      return next;
    });
  }

  function setPreset(preset: ConfidencePreset) {
    setFilters(CONFIDENCE_PRESETS[preset]);
  }

  function patchFilter<K extends keyof ConfidenceFilters>(
    key: K,
    value: ConfidenceFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
          Trusted merchants · confidence filters drive auto-check
          {fetchedAt && (
            <> · updated {new Date(fetchedAt).toLocaleTimeString()}</>
          )}
        </p>
      </form>

      <section className="calc-panel mt-4" aria-label="Confidence filters">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-medium tracking-wide uppercase text-[var(--muted)]">
            Confidence filters
          </h2>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CONFIDENCE_PRESETS) as ConfidencePreset[]).map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  className={`chip ${activePreset === key ? "chip-active" : ""}`}
                  onClick={() => setPreset(key)}
                >
                  {key}
                </button>
              ),
            )}
            {activePreset == null && <span className="chip chip-active">custom</span>}
          </div>
        </div>

        <div className="filter-grid">
          <label className="filter-field">
            <span>Min monthly trades</span>
            <input
              type="number"
              min={0}
              step={1}
              value={filters.minMonthlyTrades}
              onChange={(e) =>
                patchFilter("minMonthlyTrades", Number(e.target.value) || 0)
              }
            />
          </label>
          <label className="filter-field">
            <span>Min completion %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Number((filters.minCompletionRate * 100).toFixed(1))}
              onChange={(e) =>
                patchFilter(
                  "minCompletionRate",
                  Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                )
              }
            />
          </label>
          <label className="filter-field">
            <span>Min positive %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Number((filters.minPositiveRate * 100).toFixed(1))}
              onChange={(e) =>
                patchFilter(
                  "minPositiveRate",
                  Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                )
              }
            />
          </label>
          <label className="filter-field">
            <span>Min grade</span>
            <input
              type="number"
              min={0}
              max={5}
              step={1}
              value={filters.minUserGrade}
              onChange={(e) =>
                patchFilter("minUserGrade", Number(e.target.value) || 0)
              }
            />
          </label>
          <label className="filter-field">
            <span>Max last-seen (min)</span>
            <input
              type="number"
              min={0}
              step={5}
              value={
                filters.maxActiveSeconds > 0
                  ? Math.round(filters.maxActiveSeconds / 60)
                  : 0
              }
              onChange={(e) => {
                const mins = Number(e.target.value) || 0;
                patchFilter("maxActiveSeconds", mins > 0 ? mins * 60 : 0);
              }}
            />
            <em className="filter-hint">0 = off</em>
          </label>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={filters.massMerchantOnly}
              onChange={(e) =>
                patchFilter("massMerchantOnly", e.target.checked)
              }
            />
            <span>Mass merchants only</span>
          </label>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          {confidentAds.length} / {ads.length || 0} merchants pass · Auto-cover
          uses this pool
        </p>
      </section>

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
                  Still need {formatUsdt(quote.remainingUsdt)} USDT — loosen
                  filters or pick another merchant
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
                      @ {formatPyg(f.price)} · {f.monthOrderCount} ops
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
              Merchants ({selected.size} selected · {confidentAds.length}{" "}
              confident)
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="chip"
                onClick={() => applyAutoCover(confidentAds, usdtTarget)}
              >
                Auto-cover
              </button>
              <button
                type="button"
                className="chip"
                onClick={() =>
                  setSelected(new Set(confidentAds.map((a) => a.advNo)))
                }
              >
                All confident
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setSelected(new Set())}
              >
                None
              </button>
              <button
                type="button"
                className={`chip ${showExcluded ? "chip-active" : ""}`}
                onClick={() => setShowExcluded((v) => !v)}
              >
                {showExcluded ? "Hide excluded" : "Show excluded"}
              </button>
            </div>
          </div>

          <ul className="merchant-list">
            {visibleAds.map((ad) => {
              const checked = selected.has(ad.advNo);
              const fill = fillByAdv.get(ad.advNo);
              const maxUsdt = maxUsdtForAd(ad);
              const ok = passesConfidence(ad, filters);
              const failReasons = confidenceFailReasons(ad, filters);

              return (
                <li
                  key={ad.advNo}
                  className={`merchant-row ${checked ? "selected" : ""} ${fill ? "in-fill" : ""} ${ok ? "" : "excluded"}`}
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
                          {ok ? (
                            <span className="badge ok">Passes filters</span>
                          ) : (
                            <span className="badge warn">
                              Excluded: {describeFailReasons(failReasons)}
                            </span>
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
                          Active{" "}
                          <strong>{formatActive(ad.activeTimeInSecond)}</strong>
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
