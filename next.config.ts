import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Permet de lancer une seconde instance (scripts/dev-local.mjs) sans verrou sur .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  reactStrictMode: false,
  allowedDevOrigins: ["192.168.229.1"],
};

export default nextConfig;
