import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://amazflow.com"),
  title: { default: "AmazFlow — The execution layer for operations", template: "%s | AmazFlow" },
  description: "AmazFlow executes repetitive operational work across the applications, spreadsheets, websites, inboxes, and systems your team already uses.",
  openGraph: { title: "AmazFlow — Automate the work between your systems", description: "Your team shouldn't be the API.", url: "https://amazflow.com", siteName: "AmazFlow", type: "website" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
