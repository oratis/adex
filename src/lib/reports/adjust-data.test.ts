import { describe, expect, it } from "vitest";
import {
  classifyAdjustSource,
  normalizeAdjustReport,
  parseAdjustPlan,
  validateRange,
  completedAdjustRange,
} from "./adjust-data";

const plan = {
  version: 1,
  appToken: "luddi-fixture",
  appName: "Luddi",
  productId: null,
  currency: "USD",
  utcOffset: "+00:00",
  attributionSource: "first",
  reattributed: "false",
  autoSync: false,
  metricsConfirmed: true,
  metrics: {
    registration: { id: "luddi_signup", name: "Signup", kind: "events" },
  },
  sourceRules: [],
};

describe("Adjust source classification", () => {
  it("keeps explicit organic, recognized paid and unknown separate", () => {
    expect(
      classifyAdjustSource({ network: "Organic", partner: "Organic" }),
    ).toMatchObject({ traffic: "organic", platform: null });
    expect(
      classifyAdjustSource({
        network: "Facebook Installs",
        partner: "facebook",
      }),
    ).toMatchObject({ traffic: "paid", platform: "meta" });
    expect(
      classifyAdjustSource({
        network: "Apple Search Ads",
        partner: "apple_search_ads",
      }),
    ).toMatchObject({ traffic: "paid", platform: "asa" });
    expect(
      classifyAdjustSource({
        network: "my newsletter",
        campaign_network: "Google campaign",
      }),
    ).toMatchObject({ traffic: "unknown", platform: null });
    expect(classifyAdjustSource({})).toMatchObject({
      traffic: "unknown",
      platform: null,
    });
  });
  it("does not classify conflicts as organic or infer platform from a campaign name", () => {
    expect(
      classifyAdjustSource({ network: "Organic", partner: "facebook" }),
    ).toMatchObject({ traffic: "unknown", reason: "conflict" });
    expect(
      classifyAdjustSource({
        network: "not-google",
        campaign_network: "Google Ads",
      }).platform,
    ).toBeNull();
  });
  it("applies exact app-specific source mappings", () => {
    const rules = [
      {
        network: "Newsletter",
        partner: "",
        traffic: "other" as const,
        platform: null,
      },
    ];
    expect(classifyAdjustSource({ network: "Newsletter" }, rules).traffic).toBe(
      "other",
    );
    expect(
      classifyAdjustSource({ network: "Newsletter affiliate" }, rules).traffic,
    ).toBe("unknown");
  });
});

describe("Adjust configuration and report contract", () => {
  it("uses complete days in each app reporting timezone for automatic sync", () => {
    const now = new Date("2026-09-24T02:00:00Z");
    expect(completedAdjustRange("-07:00", now)).toEqual({
      startDate: "2026-09-16",
      endDate: "2026-09-22",
    });
    expect(completedAdjustRange("+08:00", now)).toEqual({
      startDate: "2026-09-17",
      endDate: "2026-09-23",
    });
  });
  it("requires explicit confirmation of event count versus unique-user semantics", () => {
    expect(() => parseAdjustPlan({ ...plan, metricsConfirmed: false })).toThrow(
      "Confirm",
    );
  });
  it("validates product-specific event mappings without inventing defaults", () => {
    const parsed = parseAdjustPlan(plan);
    expect(parsed.metrics.registration?.id).toBe("luddi_signup");
    expect(parsed.metrics.payer).toBeUndefined();
    expect(
      parseAdjustPlan({ ...plan, appToken: "cuddler-fixture", metrics: {} })
        .metrics,
    ).toEqual({});
  });
  it("rejects injected metrics, invalid currency, offsets and ambiguous mappings", () => {
    for (const changed of [
      { currency: "US" },
      { utcOffset: "+99:00" },
      {
        metrics: {
          registration: { id: "signup,cost", kind: "events", name: "bad" },
        },
      },
      { metrics: { payer: { id: "purchase", kind: "events", name: "bad" } } },
      {
        sourceRules: [
          { network: "X", partner: "", traffic: "organic", platform: "google" },
        ],
      },
    ])
      expect(() => parseAdjustPlan({ ...plan, ...changed })).toThrow();
  });
  it("rejects invalid, reversed and excessive date windows", () => {
    for (const dates of [
      ["2026-02-30", "2026-03-01"],
      ["2026-09-02", "2026-09-01"],
      ["2020-01-01", "2026-01-01"],
    ]) {
      expect(() => validateRange(dates[0], dates[1])).toThrow();
    }
    expect(validateRange("2026-09-01", "2026-09-07")).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });
  });
  it("retains raw attribution and IDs, excludes media cost and distinguishes missing from zero", () => {
    const result = normalizeAdjustReport(
      [
        {
          app_token: "luddi-fixture",
          network: "Organic",
          installs: "4",
          luddi_signup: "0",
          cost: "99",
        },
        {
          app_token: "luddi-fixture",
          partner: "facebook",
          network: "Facebook Installs",
          campaign_id_network: "campaign-1",
          installs: "3",
        },
      ],
      [{ app_token: "luddi-fixture", installs: "7", luddi_signup: "0" }],
      parseAdjustPlan(plan),
    );
    expect(result.rows[0]).toMatchObject({
      traffic: "organic",
      installs: 4,
      registration: 0,
      payer: null,
      revenue: null,
    });
    expect(result.rows[1]).toMatchObject({
      platform: "meta",
      campaignId: "campaign-1",
      registration: null,
    });
    expect(result.rows[0]).not.toHaveProperty("cost");
    expect(result.rows[1].network).toBe("Facebook Installs");
  });
  it("uses a separately queried app total, never summed unique users", () => {
    const config = parseAdjustPlan({
      ...plan,
      metrics: {
        payer: { id: "unique_payers", name: "Payers", kind: "users" },
      },
    });
    const result = normalizeAdjustReport(
      [
        { app_token: config.appToken, network: "A", unique_payers: "2" },
        { app_token: config.appToken, network: "B", unique_payers: "2" },
      ],
      [{ app_token: config.appToken, unique_payers: "3" }],
      config,
    );
    expect(result.totals.payer).toBe(3);
  });
  it("rejects another app, duplicate grain and malformed numeric values", () => {
    const config = parseAdjustPlan(plan);
    const row = { app_token: plan.appToken, network: "Organic", installs: "4" };
    expect(() =>
      normalizeAdjustReport(
        [{ ...row, app_token: "cuddler-fixture" }],
        [],
        config,
      ),
    ).toThrow();
    expect(() => normalizeAdjustReport([row, row], [], config)).toThrow(
      "Duplicate",
    );
    expect(() =>
      normalizeAdjustReport([{ ...row, installs: "garbage" }], [], config),
    ).toThrow();
  });
});
