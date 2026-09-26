import type { NextConfig } from "next";

const scriptEval =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=()",
  },
];
// Login/callback must not list Google Maps hosts. Putting *.google.com on the
// OAuth return made browsers treat the session cookie as a Google bounce.
const authCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline'" +
  scriptEval +
  "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com liftjournal:; frame-ancestors 'none'";
const appCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com" +
  scriptEval +
  "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.googleusercontent.com; media-src 'self' blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com wss://generativelanguage.googleapis.com; worker-src 'self' blob:; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com liftjournal:; frame-ancestors 'none'";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./scripts/video/analyse.py"] },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...security,
          { key: "Content-Security-Policy", value: appCsp },
        ],
      },
      {
        source: "/api/auth/:path*",
        headers: [{ key: "Content-Security-Policy", value: authCsp }],
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
