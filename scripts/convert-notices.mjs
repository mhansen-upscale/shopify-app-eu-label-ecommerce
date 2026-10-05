// Einmalig: vorhandene eu-notice-*.webp in eu-notice-*.jpg umwandeln (Shopify erlaubt kein WebP in Extensions).
// npm i -D sharp && node scripts/convert-notices.mjs
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const dir = "extensions/eu-warranty-label/assets";
const files = (await readdir(dir)).filter((f) => /^eu-notice-[a-z]{2}\.webp$/.test(f));
if (!files.length) console.log("Keine .webp-Dateien gefunden, nichts zu tun.");

for (const f of files) {
  const src = path.join(dir, f);
  const dst = src.replace(/\.webp$/, ".jpg");
  await sharp(src)
    .flatten({ background: "#ffffff" })
    .resize({ width: 1000, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(dst);
  await unlink(src);
  console.log(`✓ ${f} -> ${path.basename(dst)}`);
}
