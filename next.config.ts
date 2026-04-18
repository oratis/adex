import type { NextConfig } from "next";

// basePath is configurable so the app can live at the root of a
// dedicated domain (adexads.com) OR as a subpath of a shared domain
// (gogameclaw.com/adex). Set via NEXT_PUBLIC_BASE_PATH env var at
// build time; empty string ('' or unset) means the app serves at the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  output: "standalone",
};

export default nextConfig;
