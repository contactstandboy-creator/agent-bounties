import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type errors are checked separately via `npm run type-check`.
    // Don't block production builds on them.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
