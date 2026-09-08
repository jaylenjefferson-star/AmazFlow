import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Your Workflows",
  description: "See what AmazFlow is running for your team, what it's saved you, and what's waiting on your approval.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "AmazFlow" },
};

export const viewport: Viewport = {
  themeColor: "#FF765C",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
