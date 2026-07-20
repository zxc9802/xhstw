import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "/api/reference/*": [
      "./xiaohongshu-downloads/**/*",
      "./outputs/**/*",
      "./assets/**/*",
      "./logs/**/*",
      "./backups/**/*",
      "./exports/**/*"
    ],
    "/api/topics/*": [
      "./xiaohongshu-downloads/**/*",
      "./outputs/**/*",
      "./assets/**/*",
      "./logs/**/*",
      "./backups/**/*",
      "./exports/**/*"
    ]
  }
};

export default nextConfig;
