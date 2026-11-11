// Regenerates public icons from public/icon.svg. Requires `sharp` on NODE_PATH; the PNGs are committed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = await readFile(join(root, "public/icon.svg"));
const markPath =
  '<path d="M16 18h28l-18 14h18L22 48" fill="none" stroke="#d6f26a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';

function sizedBrand(size) {
  return Buffer.from(brand.toString().replace("<svg ", `<svg width="${size}" height="${size}" `));
}

function opaqueMark(size, scaleRatio) {
  const scale = (size * scaleRatio) / 64;
  const offset = (size - 64 * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#07110e"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${markPath}</g>
</svg>`);
}

async function png(svg, size) {
  return sharp(svg, { density: 384 }).resize(size, size, { fit: "fill" }).png().toBuffer();
}

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

const iconsDir = join(root, "public/icons");
await mkdir(iconsDir, { recursive: true });

const outputs = [
  ["icon-192.png", await png(sizedBrand(192), 192)],
  ["icon-512.png", await png(sizedBrand(512), 512)],
  ["icon-maskable-512.png", await png(opaqueMark(512, 0.62), 512)],
  ["apple-touch-icon.png", await png(opaqueMark(180, 0.7), 180)],
];

for (const [name, buffer] of outputs) {
  await writeFile(join(iconsDir, name), buffer);
}

await writeFile(join(root, "public/favicon.ico"), toIco(await png(sizedBrand(32), 32)));
