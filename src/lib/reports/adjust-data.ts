export type Traffic = "organic" | "paid" | "other" | "unknown";
export type MetricSlot = "registration" | "payer" | "revenue";
export type AdjustMetric = {
  id: string;
  name: string;
  kind: "events" | "users" | "money";
};
export type SourceRule = {
  network: string;
  partner: string;
  traffic: Traffic;
  platform: string | null;
};
export type AdjustPlan = {
  version: 1;
  appToken: string;
  appName: string;
  productId: string | null;
  currency: string;
  utcOffset: string;
  attributionSource: "first" | "dynamic";
  reattributed: "all" | "false";
  autoSync: boolean;
  metricsConfirmed: boolean;
  metrics: Partial<Record<MetricSlot, AdjustMetric>>;
  sourceRules: SourceRule[];
};
export const ADJUST_PLATFORMS = [
  "google",
  "meta",
  "tiktok",
  "asa",
  "applovin",
  "unity",
  "snapchat",
  "amazon",
  "other",
] as const;
export const METRIC_SLOTS: MetricSlot[] = ["registration", "payer", "revenue"];
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const canonical = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
const validId = (value: string) => /^[a-zA-Z0-9_.-]{1,160}$/.test(value);

export function parseAdjustPlan(value: unknown): AdjustPlan {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !validId(text(value.appToken)) ||
    !text(value.appName) ||
    text(value.appName).length > 200
  )
    throw new Error("Invalid Adjust app configuration");
  if (
    !/^[A-Z]{3}$/.test(text(value.currency)) ||
    !/^[+-](0\d|1[0-4]):(00|15|30|45)$/.test(text(value.utcOffset))
  )
    throw new Error("Invalid reporting currency or UTC offset");
  if (
    !["first", "dynamic"].includes(text(value.attributionSource)) ||
    !["all", "false"].includes(text(value.reattributed)) ||
    typeof value.autoSync !== "boolean"
  )
    throw new Error("Invalid attribution settings");
  if (value.productId !== null && !validId(text(value.productId)))
    throw new Error("Invalid product");
  if (
    !isRecord(value.metrics) ||
    Object.keys(value.metrics).some(
      (key) => !METRIC_SLOTS.includes(key as MetricSlot),
    )
  )
    throw new Error("Invalid metric mapping");
  const metrics: AdjustPlan["metrics"] = {};
  if (Object.keys(value.metrics).length && value.metricsConfirmed !== true)
    throw new Error(
      "Confirm the selected metrics and their count, user and revenue definitions",
    );
  for (const slot of METRIC_SLOTS) {
    const metric = value.metrics[slot];
    if (metric === undefined) continue;
    if (
      !isRecord(metric) ||
      !validId(text(metric.id)) ||
      !text(metric.name) ||
      text(metric.name).length > 200 ||
      !["events", "users", "money"].includes(text(metric.kind))
    )
      throw new Error("Invalid metric mapping");
    if (slot === "payer" && metric.kind !== "users")
      throw new Error("Payers require a unique-user metric, not event counts");
    if ((slot === "revenue") !== (metric.kind === "money"))
      throw new Error("Invalid revenue metric");
    metrics[slot] = {
      id: text(metric.id),
      name: text(metric.name),
      kind: metric.kind as AdjustMetric["kind"],
    };
  }
  if (!Array.isArray(value.sourceRules) || value.sourceRules.length > 100)
    throw new Error("Invalid source rules");
  const seen = new Set<string>();
  const sourceRules = value.sourceRules.map((rule): SourceRule => {
    if (
      !isRecord(rule) ||
      !text(rule.network) ||
      text(rule.network).length > 200 ||
      text(rule.partner).length > 200 ||
      !["organic", "paid", "other", "unknown"].includes(text(rule.traffic))
    )
      throw new Error("Invalid source rule");
    const platform = text(rule.platform) || null;
    if (platform && !(ADJUST_PLATFORMS as readonly string[]).includes(platform))
      throw new Error("Invalid source platform");
    if (rule.traffic === "organic" && platform)
      throw new Error("Organic traffic cannot have a paid platform");
    const key = JSON.stringify([
      canonical(rule.network),
      canonical(rule.partner),
    ]);
    if (seen.has(key)) throw new Error("Duplicate source rule");
    seen.add(key);
    return {
      network: text(rule.network),
      partner: text(rule.partner),
      traffic: rule.traffic as Traffic,
      platform,
    };
  });
  return {
    version: 1,
    appToken: text(value.appToken),
    appName: text(value.appName),
    productId: text(value.productId) || null,
    currency: text(value.currency),
    utcOffset: text(value.utcOffset),
    attributionSource:
      value.attributionSource as AdjustPlan["attributionSource"],
    reattributed: value.reattributed as AdjustPlan["reattributed"],
    autoSync: value.autoSync,
    metricsConfirmed: value.metricsConfirmed === true,
    metrics,
    sourceRules,
  };
}

const platforms: Record<string, string> = {
  google: "google",
  "google ads": "google",
  "google adwords": "google",
  "google adwords installs": "google",
  facebook: "meta",
  meta: "meta",
  "facebook installs": "meta",
  "instagram installs": "meta",
  tiktok: "tiktok",
  "tiktok installs": "tiktok",
  "tiktok for business": "tiktok",
  "apple search ads": "asa",
  applovin: "applovin",
  unity: "unity",
  "unity ads": "unity",
  snapchat: "snapchat",
  "snapchat installs": "snapchat",
  amazon: "amazon",
};

export function classifyAdjustSource(
  row: Record<string, unknown>,
  rules: SourceRule[] = [],
) {
  const network = canonical(row.network);
  const partner = canonical(row.partner);
  const rule = rules.find(
    (rule) =>
      canonical(rule.network) === network &&
      canonical(rule.partner) === partner,
  );
  if (rule)
    return {
      traffic: rule.traffic,
      platform: rule.platform,
      reason: "explicit_rule",
    };
  const fromNetwork = platforms[network];
  const fromPartner = platforms[partner];
  if (
    (network === "organic" || partner === "organic") &&
    (fromNetwork || fromPartner)
  )
    return {
      traffic: "unknown" as Traffic,
      platform: null,
      reason: "conflict",
    };
  if (fromNetwork && fromPartner && fromNetwork !== fromPartner)
    return {
      traffic: "unknown" as Traffic,
      platform: null,
      reason: "conflict",
    };
  if (
    network === "organic" ||
    (partner === "organic" && (!network || network === "unknown"))
  )
    return {
      traffic: "organic" as Traffic,
      platform: null,
      reason: "provider_organic",
    };
  if (fromPartner || fromNetwork)
    return {
      traffic: "paid" as Traffic,
      platform: fromPartner || fromNetwork,
      reason: "known_partner",
    };
  return { traffic: "unknown" as Traffic, platform: null, reason: "unmapped" };
}

export function validateRange(startDate: string, endDate: string) {
  const valid = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (
    !valid(startDate) ||
    !valid(endDate) ||
    startDate > endDate ||
    (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 30
  )
    throw new Error("Select a valid reporting window of at most 31 days");
  return { startDate, endDate };
}

export function completedAdjustRange(utcOffset: string, now = new Date()) {
  const offset = /^([+-])(0\d|1[0-4]):(00|15|30|45)$/.exec(utcOffset);
  if (!offset) throw new Error("Invalid reporting UTC offset");
  const minutes =
    (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
  const localNow = now.getTime() + minutes * 60_000;
  const dateBefore = (days: number) =>
    new Date(localNow - days * 86_400_000).toISOString().slice(0, 10);
  return validateRange(dateBefore(7), dateBefore(1));
}

function metricValue(
  row: Record<string, unknown>,
  id: string | undefined,
  money = false,
): number | null {
  if (!id || row[id] === undefined || row[id] === null || row[id] === "")
    return null;
  if (typeof row[id] !== "string" && typeof row[id] !== "number")
    throw new Error("Invalid Adjust metric value");
  const value = Number(row[id]);
  if (
    !Number.isFinite(value) ||
    (!money && (value < 0 || !Number.isSafeInteger(value)))
  )
    throw new Error("Invalid Adjust metric value");
  return value;
}

export function normalizeAdjustReport(
  rows: Record<string, unknown>[],
  totals: Record<string, unknown>[],
  plan: AdjustPlan,
) {
  if (rows.length > 5000 || totals.length > 1)
    throw new Error("Adjust report exceeds the supported size");
  const readMetrics = (row: Record<string, unknown>) => ({
    installs: metricValue(row, "installs"),
    registration: metricValue(row, plan.metrics.registration?.id),
    payer: metricValue(row, plan.metrics.payer?.id),
    revenue: metricValue(row, plan.metrics.revenue?.id, true),
  });
  const checkApp = (row: Record<string, unknown>) => {
    if (row.app_token !== plan.appToken)
      throw new Error("Unexpected Adjust app in report");
  };
  const seen = new Set<string>();
  const normalized = rows.map((row) => {
    checkApp(row);
    const dimensions = {
      network: text(row.network),
      partner: text(row.partner),
      os: text(row.os_name),
      accountId: text(row.ad_account_id),
      campaignId: text(row.campaign_id_network),
      campaignName: text(row.campaign_network),
    };
    const key = JSON.stringify(dimensions);
    if (seen.has(key)) throw new Error("Duplicate Adjust report grain");
    seen.add(key);
    return {
      ...dimensions,
      ...classifyAdjustSource(row, plan.sourceRules),
      ...readMetrics(row),
    };
  });
  if (totals[0]) checkApp(totals[0]);
  return {
    rows: normalized,
    totals: readMetrics(totals[0] ?? {}),
    missingMetrics: METRIC_SLOTS.filter((slot) => !plan.metrics[slot]),
  };
}

export type AdjustNormalizedReport = ReturnType<typeof normalizeAdjustReport>;
