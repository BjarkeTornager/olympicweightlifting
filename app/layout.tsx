import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";
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
// Titles and Coach's replies are set in a serif. Safari shows Apple's New
// York through ui-serif (see --font-serif), so Newsreader (SIL OFL 1.1) is
// not preloaded: other browsers fetch it when a title first needs it.
// next/font downloads it at build time and serves it from this application.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
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
    { media: "(prefers-color-scheme: light)", color: "#efeeea" },
    { media: "(prefers-color-scheme: dark)", color: "#121214" },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${barlow.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
