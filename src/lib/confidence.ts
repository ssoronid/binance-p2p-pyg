import type { P2PAd } from "./binance-p2p";

export type ConfidenceFilters = {
  /** Minimum completed monthly trades / ops */
  minMonthlyTrades: number;
  /** 0–1, e.g. 0.95 = 95% */
  minCompletionRate: number;
  /** 0–1 positive feedback */
  minPositiveRate: number;
  /** Binance user grade (typically 1–3+) */
  minUserGrade: number;
  /** Must have been online within this many seconds (0 = off) */
  maxActiveSeconds: number;
  /** Prefer mass merchants when true */
  massMerchantOnly: boolean;
};

export type ConfidencePreset = "loose" | "balanced" | "strict";

export const CONFIDENCE_PRESETS: Record<
  ConfidencePreset,
  ConfidenceFilters
> = {
  loose: {
    minMonthlyTrades: 10,
    minCompletionRate: 0.85,
    minPositiveRate: 0.9,
    minUserGrade: 0,
    maxActiveSeconds: 0,
    massMerchantOnly: false,
  },
  balanced: {
    minMonthlyTrades: 50,
    minCompletionRate: 0.95,
    minPositiveRate: 0.97,
    minUserGrade: 1,
    maxActiveSeconds: 3600 * 6,
    massMerchantOnly: false,
  },
  strict: {
    minMonthlyTrades: 150,
    minCompletionRate: 0.98,
    minPositiveRate: 0.99,
    minUserGrade: 2,
    maxActiveSeconds: 3600,
    massMerchantOnly: true,
  },
};

export const DEFAULT_CONFIDENCE: ConfidenceFilters =
  CONFIDENCE_PRESETS.balanced;

export type ConfidenceFailReason =
  | "monthly_trades"
  | "completion"
  | "positive"
  | "grade"
  | "active"
  | "identity";

export function confidenceFailReasons(
  ad: P2PAd,
  filters: ConfidenceFilters,
): ConfidenceFailReason[] {
  const reasons: ConfidenceFailReason[] = [];

  if (ad.monthOrderCount < filters.minMonthlyTrades) {
    reasons.push("monthly_trades");
  }
  if (ad.monthFinishRate < filters.minCompletionRate) {
    reasons.push("completion");
  }
  if (ad.positiveRate < filters.minPositiveRate) {
    reasons.push("positive");
  }
  if (ad.userGrade < filters.minUserGrade) {
    reasons.push("grade");
  }
  if (
    filters.maxActiveSeconds > 0 &&
    (ad.activeTimeInSecond == null ||
      ad.activeTimeInSecond > filters.maxActiveSeconds)
  ) {
    reasons.push("active");
  }
  if (
    filters.massMerchantOnly &&
    ad.userIdentity !== "MASS_MERCHANT"
  ) {
    reasons.push("identity");
  }

  return reasons;
}

export function passesConfidence(
  ad: P2PAd,
  filters: ConfidenceFilters,
): boolean {
  return confidenceFailReasons(ad, filters).length === 0;
}

export function filterConfidentAds(
  ads: P2PAd[],
  filters: ConfidenceFilters,
): P2PAd[] {
  return ads.filter((ad) => passesConfidence(ad, filters));
}

export function describeFailReasons(
  reasons: ConfidenceFailReason[],
): string {
  const labels: Record<ConfidenceFailReason, string> = {
    monthly_trades: "ops",
    completion: "completion",
    positive: "positive",
    grade: "grade",
    active: "offline",
    identity: "not mass merchant",
  };
  return reasons.map((r) => labels[r]).join(", ");
}

/** Detect which preset matches, or null if custom. */
export function matchPreset(
  filters: ConfidenceFilters,
): ConfidencePreset | null {
  for (const key of Object.keys(CONFIDENCE_PRESETS) as ConfidencePreset[]) {
    const p = CONFIDENCE_PRESETS[key];
    if (
      p.minMonthlyTrades === filters.minMonthlyTrades &&
      p.minCompletionRate === filters.minCompletionRate &&
      p.minPositiveRate === filters.minPositiveRate &&
      p.minUserGrade === filters.minUserGrade &&
      p.maxActiveSeconds === filters.maxActiveSeconds &&
      p.massMerchantOnly === filters.massMerchantOnly
    ) {
      return key;
    }
  }
  return null;
}

export function parseConfidenceFromSearchParams(
  params: URLSearchParams,
): ConfidenceFilters {
  const base = { ...DEFAULT_CONFIDENCE };
  const preset = params.get("preset") as ConfidencePreset | null;
  if (preset && CONFIDENCE_PRESETS[preset]) {
    Object.assign(base, CONFIDENCE_PRESETS[preset]);
  }

  const num = (key: string, fallback: number) => {
    const raw = params.get(key);
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    minMonthlyTrades: num("minTrades", base.minMonthlyTrades),
    minCompletionRate: num("minCompletion", base.minCompletionRate),
    minPositiveRate: num("minPositive", base.minPositiveRate),
    minUserGrade: num("minGrade", base.minUserGrade),
    maxActiveSeconds: num("maxActive", base.maxActiveSeconds),
    massMerchantOnly:
      params.get("massOnly") === "1"
        ? true
        : params.get("massOnly") === "0"
          ? false
          : base.massMerchantOnly,
  };
}
