import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./journal-design.css";
import "./theme.css";
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
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
