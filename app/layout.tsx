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
  title: "Zilla Milestones by Zilla Labs",
  description: "Turn a project scope into PayPal-invoiced milestones and reschedule work as payments land.",
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
