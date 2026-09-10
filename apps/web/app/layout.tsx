import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { Analytics } from "./lib/analytics";
import { IntercomMessenger } from "./lib/intercom";
import "./styles.css";

/**
 * Fonts are self-hosted rather than fetched from fonts.googleapis.com at runtime.
 *
 * Three reasons, in order of how much they matter:
 *
 * 1. Privacy. A stylesheet @import to Google sent every visitor's IP address to a third party on
 *    every page load, which the Cookie Policy did not disclose. Self-hosting removes the request,
 *    so there is nothing to disclose.
 * 2. Speed. An @import inside a stylesheet is discovered only after that stylesheet parses, so the
 *    font request was serialised behind the CSS instead of starting with it. Next inlines the font
 *    declarations and preloads the files from our own origin.
 * 3. Stability. next/font emits a size-adjusted local fallback, so the fallback and real face
 *    occupy near-identical space and large display type no longer reflows as it swaps in.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://amazflow.com"),
  title: { default: "AmazFlow — The execution layer for operations", template: "%s | AmazFlow" },
  description: "AmazFlow executes repetitive operational work across the applications, spreadsheets, websites, inboxes, and systems your team already uses.",
  openGraph: { title: "AmazFlow — Automate the work between your systems", description: "Your team shouldn't be the API.", url: "https://amazflow.com", siteName: "AmazFlow", type: "website" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}>
      <body>
        {children}
        {/* Both decide for themselves whether to run, and neither runs in the /app operator
            console. Analytics also stays out of the /console customer workspace. See their
            respective modules in ./lib. */}
        <Analytics />
        <IntercomMessenger />
      </body>
    </html>
  );
}
