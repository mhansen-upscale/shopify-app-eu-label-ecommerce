import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as fontkit from "fontkit";
import geometry from "./garan-geometry.json";

// Bilder für Checkout und Bestellbestätigung: dort gibt es keine Theme-Assets und keine eigene Schrift, nur gehostete
// Bilder. Das GARAN-Label entsteht wie in snippets/garan-label.liquid aus der offiziellen Vorlage ohne Textfelder; die
// drei editierbaren Felder werden als Inter-Glyphen (Umrisse) an den Originalkoordinaten eingesetzt, Laufweiten ohne
// Unterschneidung wie in der Breitenprüfung (app/lib/garan.ts).
// RENDER_VERSION erhöhen, wenn sich Vorlage oder Satz ändern: Dann entstehen neue Dateien, alte bleiben für versandte Mails.
export const RENDER_VERSION = 1;

// Theme-Assets sind die einzige Quelle der amtlichen Grafiken (Dockerfile kopiert den Ordner ins Image)
const ASSETS = path.join(process.cwd(), "extensions/eu-warranty-label/assets");
const FONTS = path.join(process.cwd(), "node_modules/@fontsource/inter/files");
const INK = "#231f20"; // Textfarbe der offiziellen Vorlage

// Gleiche Dateien und Reihenfolge wie scripts/fetch-eu-labels.mjs (inter-metrics.json): erste Datei mit dem Zeichen gewinnt
const FONT_FILES = {
  regular: ["latin", "latin-ext", "greek", "cyrillic"].map((s) => `inter-${s}-400-normal.woff2`),
  extrabold: ["inter-latin-800-normal.woff2"],
};

let fonts: Promise<Record<keyof typeof FONT_FILES, fontkit.Font[]>> | null = null;
const loadFonts = () => (fonts ??= (async () => {
  const load = (files: string[]) => Promise.all(files.map(async (f) => fontkit.create(await readFile(path.join(FONTS, f)))));
  return { regular: await load(FONT_FILES.regular), extrabold: await load(FONT_FILES.extrabold) };
})());

/** Text als Glyphen-Umrisse; x = Anfang, oder Ende bei align "end" (wie text-anchor="end" inkl. letztem Buchstabenabstand). */
function textPaths(faces: fontkit.Font[], text: string, opts: { x: number; y: number; size: number; letterSpacing?: number; align?: "start" | "end" }) {
  const spacing = (opts.letterSpacing ?? 0) * opts.size;
  const glyphs = [...text].map((ch) => {
    const cp = ch.codePointAt(0)!;
    const font = faces.find((f) => f.hasGlyphForCodePoint(cp));
    if (!font) throw new Error(`Zeichen "${ch}" nicht in Inter enthalten`);
    const glyph = font.glyphForCodePoint(cp);
    const scale = opts.size / font.unitsPerEm;
    return { d: glyph.path.toSVG(), scale, advance: glyph.advanceWidth * scale + spacing };
  });
  const width = glyphs.reduce((w, g) => w + g.advance, 0);
  let x = opts.align === "end" ? opts.x - width : opts.x;
  return glyphs.map((g) => {
    const out = g.d ? `<path transform="translate(${x.toFixed(3)} ${opts.y}) scale(${g.scale.toFixed(6)} ${(-g.scale).toFixed(6)})" d="${g.d}"/>` : "";
    x += g.advance;
    return out;
  }).join("");
}

export type GaranLabel = { years: string; brand: string; model: string };

/** Volles GARAN-Label als PNG (1100 px breit wie garan-full-template.png). years mit Komma, z. B. "5" oder "4,5". */
export async function renderGaranPng({ years, brand, model }: GaranLabel): Promise<Buffer> {
  const { regular, extrabold } = await loadFonts();
  const g = geometry.full;
  const template = path.join(ASSETS, "garan-full-template.png");
  const { width, height } = await sharp(template).metadata();
  const anchors = g.years.anchors as Record<string, number>;
  const anchor = anchors[years.slice(-1)];
  if (anchor === undefined) throw new Error(`Ungültige Dauer "${years}"`);
  const paths = [
    textPaths(regular, brand, { x: g.brand.x, y: g.brand.y, size: g.brand.size }),
    textPaths(regular, model, { x: g.model.xEnd, y: g.model.y, size: g.model.size, align: "end" }),
    textPaths(extrabold, years, { x: anchor, y: g.years.y, size: g.years.size, letterSpacing: g.years.letterSpacing, align: "end" }),
  ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${g.viewBox[0]} ${g.viewBox[1]}"><g fill="${INK}">${paths}</g></svg>`;
  return sharp(template).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png({ compressionLevel: 9 }).toBuffer();
}

/** Offizielle Mitteilung (Anhang I) einer Sprachfassung, unverändert aus den Theme-Assets. */
export function noticePng(lang: string): Promise<Buffer> {
  if (!/^[a-z]{2}$/.test(lang)) throw new Error(`Ungültige Sprache "${lang}"`);
  return readFile(path.join(ASSETS, `eu-notice-${lang}.png`));
}
