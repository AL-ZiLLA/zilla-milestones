import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Zilla Milestones — Get paid before the next phase starts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public/icons/icon-512.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#07110e",
          color: "white",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <img src={logoSrc} width={148} height={148} alt="" />
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, color: "#d6f26a" }}>ZILLA OS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.02 }}>Milestones</div>
          <div style={{ fontSize: 36, color: "#d5dee6" }}>Get paid before the next phase starts</div>
          <div style={{ fontSize: 24, letterSpacing: 0.4, color: "#d6f26a" }}>milestones.zillalabs.ai</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
