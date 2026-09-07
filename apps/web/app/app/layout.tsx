import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Demo",
  description: "Explore the AmazFlow operations execution control plane with synthetic data.",
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
