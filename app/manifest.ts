import type { MetadataRoute } from "next";
import { BACKGROUND_COLOR, THEME_COLOR } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zilla Milestones",
    short_name: "Milestones",
    description:
      "Get paid before the next phase starts. Zilla Milestones turns a scope into PayPal-invoiced phases on a Bryntum Gantt.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    lang: "en",
    dir: "ltr",
    orientation: "any",
    categories: ["business", "finance", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
