import type { NextConfig } from "next";
import path from "node:path";

const backendUrl = (process.env.SCOPE_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "..") },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
