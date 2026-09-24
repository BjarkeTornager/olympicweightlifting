import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./journal-design.css";
import "./theme.css";
const barlow = localFont({
  src: [
    { path: "./fonts/Barlow-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Barlow-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Barlow-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Barlow-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-journal",
  display: "swap",
  adjustFontFallback: "Arial",
});
// Titles, weights and reps: condensed like plate markings and scoreboards.
const barlowCondensed = localFont({
  src: [
    {
      path: "./fonts/BarlowCondensed-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/BarlowCondensed-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/BarlowCondensed-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-display",
  display: "swap",
  adjustFontFallback: "Arial",
});
export const metadata: Metadata = {
  title: "Lift Journal",
  robots: { index: false, follow: false },
  description:
    "Your strength, cardio, nutrition and recovery, connected in a private health journal.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Lift Journal",
    statusBarStyle: "default",
  },
  icons: { icon: "/assets/icon.svg", apple: "/assets/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f13" },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
