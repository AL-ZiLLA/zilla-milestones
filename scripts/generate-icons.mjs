// Publishes the official Zilla AI mark. Exact files are copied byte-for-byte.
// 192, apple-touch 180, and the maskable tile are scaled or padded from those
// files. Nothing is redrawn or recolored. Requires `sharp` on NODE_PATH.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "brand");
const iconsDir = join(root, "public/icons");

function toIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);
  entry.writeUInt8(32, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuffer]);
}

async function opaqueRadius(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = (info.width - 1) / 2;
  const cy = (info.height - 1) / 2;
  let maxR = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < 8) continue;
      const radius = Math.hypot(x - cx, y - cy);
      if (radius > maxR) maxR = radius;
    }
  }
  return { maxR, width: info.width };
}

await mkdir(iconsDir, { recursive: true });

await copyFile(join(brand, "z-mark-ai.svg"), join(root, "public/icon.svg"));
await copyFile(join(brand, "z-mark-ai-512.png"), join(iconsDir, "icon-512.png"));
await copyFile(join(brand, "z-mark-ai-light-32.png"), join(root, "public/favicon-32.png"));
await copyFile(join(brand, "powered-by-zilla-ai-inline-dark.svg"), join(root, "public/powered-by-zilla-ai.svg"));

const dark512 = await readFile(join(brand, "z-mark-ai-512.png"));
const light512 = await readFile(join(brand, "z-mark-ai-light-512.png"));
const light32 = await readFile(join(brand, "z-mark-ai-light-32.png"));

await writeFile(join(iconsDir, "icon-192.png"), await sharp(dark512).resize(192, 192, { fit: "fill" }).png().toBuffer());
await writeFile(
  join(iconsDir, "apple-touch-icon.png"),
  await sharp(dark512).resize(180, 180, { fit: "fill" }).png().toBuffer(),
);
await writeFile(join(root, "public/favicon.ico"), toIco(light32));

// Maskable safe zone is a circle of radius 40% of the tile. The light mark
// (dark bars and "AI") sits inside that circle on white so a circular mask
// cannot crop it, and the bars stay visible.
const { maxR, width } = await opaqueRadius(light512);
const tile = 512;
const targetR = tile * 0.38;
const drawn = Math.max(1, Math.round((width * targetR) / maxR));
const resized = await sharp(light512).resize(drawn, drawn, { fit: "fill" }).png().toBuffer();
const maskable = await sharp({
  create: {
    width: tile,
    height: tile,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([{ input: resized, gravity: "center" }])
  .png()
  .toBuffer();
await writeFile(join(iconsDir, "icon-maskable-512.png"), maskable);
