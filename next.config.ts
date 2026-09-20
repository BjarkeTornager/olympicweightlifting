import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./scripts/video/analyse.py"] },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.google.com https://*.googleusercontent.com; media-src 'self' blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com; worker-src blob:; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};
export default config;
