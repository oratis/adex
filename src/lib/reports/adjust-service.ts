import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AdjustClient } from "@/lib/platforms/adjust";
import { openCredential, sealCredential } from "@/lib/platform-credential";
import {
  completedAdjustRange,
  parseAdjustPlan,
  validateRange,
  type AdjustPlan,
} from "./adjust-data";

export class AdjustSetupError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const configHash = (plan: AdjustPlan) =>
  createHash("sha256").update(JSON.stringify(plan)).digest("hex");

export function parsePlan(input: unknown) {
  try {
    return parseAdjustPlan(input);
  } catch (error) {
    throw new AdjustSetupError(
      400,
      error instanceof Error ? error.message : "Invalid configuration",
    );
  }
}
export function parseRange(start: unknown, end: unknown) {
  try {
    return validateRange(String(start ?? ""), String(end ?? ""));
  } catch {
    throw new AdjustSetupError(400, "Select a valid window of at most 31 days");
  }
}
export async function adjustClient(orgId: string, appToken = "") {
  const auth = await prisma.platformAuth.findUnique({
    where: { orgId_platform: { orgId, platform: "adjust" } },
  });
  if (!auth?.isActive || !auth.apiKey)
    throw new AdjustSetupError(404, "Connect Adjust first");
  return new AdjustClient({
    apiToken: openCredential(auth.apiKey, `${orgId}:adjust`),
    appToken,
  });
}

export async function connectAdjust(
  orgId: string,
  userId: string,
  token: unknown,
) {
  if (
    typeof token !== "string" ||
    !token.trim() ||
    token.length > 4096 ||
    /\s/.test(token.trim())
  )
    throw new AdjustSetupError(400, "Invalid API token");
  const encrypted = sealCredential(token.trim(), `${orgId}:adjust`);
  const apps = await new AdjustClient({
    apiToken: token.trim(),
    appToken: "",
  }).listApps();
  await prisma.platformAuth.upsert({
    where: { orgId_platform: { orgId, platform: "adjust" } },
    update: { apiKey: encrypted, isActive: true },
    create: { orgId, userId, platform: "adjust", apiKey: encrypted },
  });
  return { connected: true, apps };
}

export async function verifyPlan(orgId: string, plan: AdjustPlan) {
  const client = await adjustClient(orgId, plan.appToken);
  const app = (await client.listApps()).find((app) => app.id === plan.appToken);
  if (!app)
    throw new AdjustSetupError(
      400,
      "App is not accessible through this connection",
    );
  const events = await client.listEvents();
  for (const metric of Object.values(plan.metrics)) {
    if (!events.some((event) => event.id === metric.id))
      throw new AdjustSetupError(
        400,
        "Selected metric is not available for this app",
      );
  }
  if (
    plan.productId &&
    !(await prisma.promotedApp.findFirst({
      where: { id: plan.productId, orgId },
      select: { id: true },
    }))
  )
    throw new AdjustSetupError(
      400,
      "Product does not belong to this workspace",
    );
  return client;
}

export async function saveAdjustPlan(orgId: string, plan: AdjustPlan) {
  await verifyPlan(orgId, plan);
  const extra = JSON.stringify(plan);
  const account = await prisma.platformAccount.upsert({
    where: {
      orgId_platform_accountId: {
        orgId,
        platform: "adjust",
        accountId: plan.appToken,
      },
    },
    update: { extra, displayName: plan.appName, isActive: true },
    create: {
      orgId,
      platform: "adjust",
      accountId: plan.appToken,
      displayName: plan.appName,
      extra,
    },
  });
  return { id: account.id, plan };
}

export async function previewAdjust(
  orgId: string,
  plan: AdjustPlan,
  startDate: string,
  endDate: string,
) {
  const client = await verifyPlan(orgId, plan);
  return {
    plan,
    startDate,
    endDate,
    data: await client.getMappedReport(plan, startDate, endDate),
  };
}

export async function syncAdjustApp(
  orgId: string,
  appToken: string,
  startDate: string,
  endDate: string,
) {
  validateRange(startDate, endDate);
  const account = await prisma.platformAccount.findUnique({
    where: {
      orgId_platform_accountId: {
        orgId,
        platform: "adjust",
        accountId: appToken,
      },
    },
  });
  if (!account?.isActive || !account.extra)
    throw new AdjustSetupError(404, "Save this app configuration first");
  const plan = parsePlan(JSON.parse(account.extra));
  const startedAt = new Date();
  const payload = await previewAdjust(orgId, plan, startDate, endDate);
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > 4_000_000)
    throw new AdjustSetupError(
      400,
      "Report is too large; narrow the reporting window",
    );
  const snapshot = await prisma.$transaction(async (tx) => {
    // Lock the app configuration before publication; changed or disconnected
    // configurations must not receive an in-flight report from the old plan.
    const lock = await tx.platformAccount.updateMany({
      where: { id: account.id, orgId, extra: account.extra, isActive: true },
      data: { updatedAt: new Date() },
    });
    if (lock.count !== 1)
      throw new AdjustSetupError(
        409,
        "Configuration changed; preview and sync again",
      );
    const old = await tx.adjustReportSnapshot.findUnique({
      where: { accountId: account.id },
    });
    if (old && old.syncedAt > startedAt)
      throw new AdjustSetupError(
        409,
        "A newer sync completed; reload the report",
      );
    const data = {
      orgId,
      configHash: configHash(plan),
      startDate,
      endDate,
      data: serialized,
      syncedAt: new Date(),
    };
    return tx.adjustReportSnapshot.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, ...data },
      update: data,
    });
  });
  return {
    ...payload,
    syncedAt: snapshot.syncedAt.toISOString(),
    stale: false,
  };
}

export async function readAdjustSnapshot(orgId: string, appToken: string) {
  const account = await prisma.platformAccount.findUnique({
    where: {
      orgId_platform_accountId: {
        orgId,
        platform: "adjust",
        accountId: appToken,
      },
    },
    include: { adjustSnapshot: true },
  });
  if (!account?.isActive)
    throw new AdjustSetupError(404, "App is not configured");
  const snapshot = account.adjustSnapshot;
  if (!snapshot) return null;
  const plan = parsePlan(JSON.parse(account.extra || "{}"));
  return {
    ...JSON.parse(snapshot.data),
    syncedAt: snapshot.syncedAt.toISOString(),
    stale: snapshot.configHash !== configHash(plan),
  };
}

export async function syncConfiguredAdjust(
  orgId: string,
  startDate: string,
  endDate: string,
  automatic = false,
) {
  const accounts = await prisma.platformAccount.findMany({
    where: { orgId, platform: "adjust", isActive: true },
  });
  const results: Array<{
    appToken: string;
    success?: boolean;
    error?: string;
  }> = [];
  for (const account of accounts) {
    if (!account.extra) continue;
    let plan: AdjustPlan;
    try {
      plan = parseAdjustPlan(JSON.parse(account.extra));
    } catch {
      continue;
    }
    if (automatic && !plan.autoSync) continue;
    try {
      const range = automatic
        ? completedAdjustRange(plan.utcOffset)
        : { startDate, endDate };
      await syncAdjustApp(orgId, plan.appToken, range.startDate, range.endDate);
      results.push({ appToken: plan.appToken, success: true });
    } catch {
      results.push({
        appToken: plan.appToken,
        error: "Adjust sync failed; previous snapshot retained",
      });
    }
  }
  return results;
}
