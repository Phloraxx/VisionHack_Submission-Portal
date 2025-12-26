import type { NextConfig } from "next";

const nextConfig = {
  output: 'standalone',
  experimental: {
    dynamicIO: true, // Use this for Next.js 15 canary
    // or use the new unified flag in Next.js 16+
    // cacheComponents: true, 
  },
};

export default nextConfig;
