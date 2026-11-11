export const CANONICAL_ORIGIN = "https://milestones.zillalabs.ai";

export const THEME_COLOR = "#07110e";
export const BACKGROUND_COLOR = "#07110e";

export function resolveSiteUrl(configured = process.env.NEXT_PUBLIC_SITE_URL): URL {
  const value = configured?.trim();
  return new URL(value ? value : CANONICAL_ORIGIN);
}
