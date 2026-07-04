-- app_install / web_conversion campaigns point at a PromotedApp.
-- Additive nullable column; existing campaigns unaffected.
ALTER TABLE "Campaign" ADD COLUMN "promotedAppId" TEXT;
