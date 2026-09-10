import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AmazFlow",
  description: "Your AmazFlow workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
