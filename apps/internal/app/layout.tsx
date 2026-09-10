import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AmazFlow Control",
  description: "Operate the AmazFlow platform.",
  // This origin is staff-only and must never be indexed. That is not the access control -- the control
  // plane is (design decision D-2) -- it is so a customer never arrives here from a search result and
  // concludes AmazFlow leaked something.
  robots: { index: false, follow: false },
};

/** The staff console is dark by default, as `/app` is today. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
