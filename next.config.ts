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
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/sw-policy.mjs",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
