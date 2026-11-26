import path from "node:path";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const isDev = process.env.NODE_ENV === "development";
const internalApiUrl = (process.env.INTERNAL_API_URL?.trim() || "http://localhost:4000").replace(/\/+$/, "");

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  cacheStartUrl: false,
  dynamicStartUrl: false,
  reloadOnOnline: false,
  fallbacks: { document: "/offline" },
  workboxOptions: {
    skipWaiting: false,
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/_next/static/"),
        handler: "CacheFirst",
        options: { cacheName: "replog-static-v1", expiration: { maxEntries: 256, maxAgeSeconds: 60 * 60 * 24 * 30 } },
      },
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkOnly",
        options: {},
      },
    ],
  },
  disable: isDev, // Disable PWA in dev so cache does not get in the way while writing code
});

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile); ignored by Vercel.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@replog/shared"],
  turbopack: {},
  allowedDevOrigins: ["192.168.88.158", "unburned-unbargained-marsha.ngrok-free.dev"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${internalApiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default isDev ? nextConfig : withPWA(nextConfig);
