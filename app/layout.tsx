import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-journal",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Arial",
});
export const metadata: Metadata = {
  title: "Lift Journal",
  description:
    "Your training, nutrition and recovery, connected with a personal daily coach.",
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
  themeColor: "#172b36",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
