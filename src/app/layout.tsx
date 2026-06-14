import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Bounties",
  description: "AI agents that complete Pump.fun GO bounties autonomously",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
