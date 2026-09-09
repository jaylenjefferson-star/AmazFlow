import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Demo",
  description: "Operate the AmazFlow execution control plane.",
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
