import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  serverExternalPackages: [
    "@paypal/agent-toolkit",
    "@paypal/paypal-server-sdk",
    "openai",
  ],
  transpilePackages: ["@bryntum/gantt"],
};

export default nextConfig;
