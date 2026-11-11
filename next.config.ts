import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  serverExternalPackages: [
    "@paypal/agent-toolkit",
    "@paypal/paypal-server-sdk",
    "openai",
  ],
  // Do not add @bryntum/* to transpilePackages. SWC turns `static defaults = {}`
  // into an assignment, and that throws on the inherited getter-only `defaults`.
};

export default nextConfig;
