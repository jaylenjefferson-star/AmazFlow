import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AmazFlow Control Plane",
  description: "Operate the AmazFlow execution control plane.",
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
