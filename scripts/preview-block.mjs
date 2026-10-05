// Rendert den Theme-Block mit Testdaten zu statischen HTML-Seiten (ohne Entwicklungs-Shop):
//   node scripts/preview-block.mjs [ausgabeordner]   (Standard: .preview, per .gitignore ausgeschlossen)
// Danach den Ordner per HTTP ausliefern; assets/ zeigt per Symlink auf die Extension.
// Liquid-Umgebung und Testdaten-Kontext: scripts/liquid-engine.mjs

import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXT, blockContext, createEngine, renderBlock } from "./liquid-engine.mjs";

const out = path.resolve(process.argv[2] ?? ".preview");
const engine = createEngine();

const FIXTURES = [
  { id: "de-auto-nested", locale: "de", block: { notice_display: "auto", address: "neutral", garan_display: "nested" }, garan: { years: 5, brand: "Bosch Professional", model: "GSR 18V-55" } },
  { id: "de-full-sie", locale: "de", block: { notice_display: "full", address: "formal", garan_display: "full" }, garan: { years: 10, brand: "Miele", model: "WWD 320 WPS" } },
  { id: "pl-collapsed", locale: "pl", block: { notice_display: "collapsed", address: "informal", garan_display: "nested" }, garan: { years: 3, brand: "Amica", model: "PGCZ 3" } },
  { id: "de-toggle", locale: "de", block: { notice_display: "collapsed", address: "informal", garan_display: "nested" }, garan: { years: 3, brand: "Maik Hansen", model: "MH0087899" } },
  { id: "bg-full", locale: "bg", block: { notice_display: "full", address: "neutral", garan_display: "full" }, garan: { years: 99, brand: "Електра", model: "ЕЛ-2000" } },
  { id: "ja-fallback-en", locale: "ja", block: { notice_display: "auto", address: "formal", garan_display: "nested", alignment: "center" }, garan: null },
  // Varianten: 11 erbt vom Produkt, 12 hat eigene Angaben, 13 hat kein Label; Formular wie in Themes (name="id")
  { id: "de-varianten", locale: "de", block: { garan_display: "full" }, garan: { years: 3, brand: "Maik Hansen", model: "MH-S" },
    variants: [{ id: 11, title: "S" }, { id: 12, title: "XL", metafields: { garan_confirmed: true, garan_duration: 10, garan_brand: "Maik Hansen", garan_model: "MH-XL" } }, { id: 13, title: "Muster", metafields: { garan_confirmed: false } }] },
  { id: "de-warenkorb", file: "eu-warranty-cart", locale: "de", template: "cart", block: {}, garan: null,
    cart: { item_count: 2, items: [
      { product: { title: "Akku-Bohrschrauber", tags: [], "gift_card?": false, collections: [], has_only_default_variant: true, variants: [],
          metafields: { "$app:eu_warranty": { garan_confirmed: { value: true }, garan_duration: { value: 5 }, garan_brand: { value: "Bosch" }, garan_model: { value: "GSR 18V-55" } } } },
        variant: { id: 1, title: "Default Title", requires_shipping: true, metafields: {} } },
      { product: { title: "Bit-Set", tags: [], "gift_card?": false, collections: [], has_only_default_variant: true, variants: [], metafields: { "$app:eu_warranty": {} } },
        variant: { id: 2, title: "Default Title", requires_shipping: true, metafields: {} } },
    ] } },
  { id: "de-embed-band", file: "eu-warranty-embed", locale: "de", template: "cart", block: { position: "sticky", address: "formal" }, garan: null },
];

const page = (title, body) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  /* grobe Theme-Nachbildung inkl. globaler Button-Stile, die der Block neutralisieren muss */
  body{font-family:system-ui,sans-serif;margin:0;color:#222;background:#fff}
  main{max-width:1100px;margin:0 auto;padding:16px;display:grid;gap:24px}
  @media (min-width:750px){main{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
  .gallery{background:#eee;aspect-ratio:1;border-radius:8px}
  button{background:#111;color:#fff;padding:12px 24px;border-radius:4px;min-height:44px;text-transform:uppercase;letter-spacing:.1em}
  nav a{margin-right:1rem}
</style>
<link rel="stylesheet" href="assets/eu-warranty.css">
</head><body><main><div class="gallery"></div><div class="info"><h1>Akku-Bohrschrauber</h1><p>129,00 €</p>
<button type="button">In den Warenkorb</button>
${body}
<div style="height:600px"></div></div></main>
<script src="assets/eu-warranty.js" defer></script></body></html>`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await symlink(path.join(EXT, "assets"), path.join(out, "assets"));
const links = [];
for (const f of FIXTURES) {
  const html = await renderBlock(engine, f.file ?? "eu-warranty", blockContext({
    id: f.id, locale: f.locale, block: f.block, template: f.template, cart: f.cart, variants: f.variants,
    settings: { excludeTags: ["b2b"], usedTag: "gebraucht" },
    metafields: f.garan ? { garan_confirmed: true, garan_duration: f.garan.years, garan_brand: f.garan.brand, garan_model: f.garan.model } : {},
  })) + (f.variants ? `<form action="/cart/add"><label>Größe <select name="id">${f.variants.map((v) => `<option value="${v.id}">${v.title}</option>`).join("")}</select></label></form>` : "");
  await writeFile(path.join(out, `${f.id}.html`), page(f.id, html));
  links.push(`<li><a href="${f.id}.html">${f.id}</a></li>`);
}
await writeFile(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Vorschau</title><ul>${links.join("")}</ul>`);
console.log(`✓ ${FIXTURES.length} Vorschauseiten in ${path.relative(process.cwd(), out) || out}`);
