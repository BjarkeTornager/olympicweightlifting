import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import "./journal-design.css";
import "./theme.css";
import { siteLanguage } from "@/lib/text-language";
// The interface is set in the system face (San Francisco on Apple devices,
// see --font-ui). Inter (SIL OFL 1.1) stands in only where no system face
// resolves, so it is not preloaded either.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});
// Titles and Coach's replies are set in a serif. Safari shows Apple's New
// York through ui-serif (see --font-serif), so Newsreader (SIL OFL 1.1) is
// not preloaded: other browsers fetch it when a title first needs it.
// next/font downloads both at build time and serves them from this
// application, so browsers never contact Google.
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
    // British English, as the copy is written ("programme", "favourite"), so
    // browsers hyphenate it by British rules.
    <html
      lang={siteLanguage}
      className={`${inter.variable} ${newsreader.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
