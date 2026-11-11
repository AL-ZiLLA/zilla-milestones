import type { Metadata, Viewport } from "next";
import { Outfit, Syne } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { resolveSiteUrl, THEME_COLOR } from "@/lib/site";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
});

const siteUrl = resolveSiteUrl();
const description =
  "Get paid before the next phase starts. Zilla Milestones turns a scope into PayPal-invoiced phases on a Bryntum Gantt.";
const socialDescription = "Get paid before the next phase starts.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Zilla Milestones",
  description,
  applicationName: "Zilla Milestones",
  alternates: { canonical: "/" },
  appleWebApp: {
    capable: true,
    title: "Milestones",
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Zilla Milestones",
    description: socialDescription,
    siteName: "Zilla Milestones",
    type: "website",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Zilla Milestones — Get paid before the next phase starts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zilla Milestones",
    description: socialDescription,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans text-zinc-100 antialiased`}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
