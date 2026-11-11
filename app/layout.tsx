import type { Metadata } from "next";
import { Outfit, Syne } from "next/font/google";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Zilla OS / Milestones",
  description: "Get paid before the next phase starts. Zilla Milestones turns a scope into PayPal-invoiced phases on a Bryntum Gantt.",
  applicationName: "Zilla OS",
  openGraph: {
    title: "Zilla OS / Milestones",
    description: "Get paid before the next phase starts.",
    siteName: "Zilla OS",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans text-zinc-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
