/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["@jackwener/opencli", "ws"],
  outputFileTracingExcludes: {
    "/api/tiktok/*": ["./outputs/**/*"],
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

module.exports = nextConfig;
