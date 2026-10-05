// Release-Check: sind die amtlichen Vorlagen vollständig und korrekt eingebunden? `node scripts/check-legal.mjs`
// Prüft unabhängig vom Build-Skript gegen die Praxisleitlinien der Kommission (April 2026).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import sharp from "sharp";

const dir = "extensions/eu-warranty-label";
const langs = "bg,cs,da,de,el,en,es,et,fi,fr,ga,hr,hu,it,lt,lv,mt,nl,pl,pt,ro,sk,sl,sv".split(",");
const problems = [];

// Ziel des QR-Codes je Sprache, Tabelle aus den Praxisleitlinien 2.3 (muss als klickbarer Link im Shop stehen)
const NOTICE_URLS = {
  bg: "гаранции", hr: "jamstva_hr", cs: "záruky_cs", da: "garantier", nl: "garantie", de: "garantien", el: "εγγυήσεις",
  en: "guarantees", et: "garantiid", fi: "virhevastuu", fr: "garanties", hu: "jótállás", ga: "ráthaíochtaí", it: "garanzie",
  lt: "garantijos", lv: "garantijas", mt: "garanziji", pl: "gwarancje", pt: "garantias", ro: "garanții", sk: "záruky_sk",
  sl: "jamstva_sl", es: "garantías", sv: "reklamationsrätt",
};
const GARAN_URL = "https://europa.eu/youreurope/commercial-guarantee-durability/index.htm";

// 1. Grafiken: offizielle Kommissionsdateien (A4 bei 200 dpi), randlos, oben nicht beschnitten
for (const l of langs) {
  const file = `${dir}/assets/eu-notice-${l}.png`;
  if (!existsSync(file)) { problems.push(`Fehlt: assets/eu-notice-${l}.png (Anhang I, ${l.toUpperCase()})`); continue; }
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 1650 || info.width > 1660 || info.height > 2339) problems.push(`eu-notice-${l}.png: ${info.width}×${info.height}, erwartet offizielle A4-Breite 1654 px`);
  let topInk = 0;
  for (let x = 0; x < info.width; x++) if (data[x] < 200) topInk++;
  if (topInk < info.width / 2) problems.push(`eu-notice-${l}.png: oberer Rand nicht farbig – Grafik oben beschnitten oder verschoben?`);
}
for (const f of readdirSync(`${dir}/assets`)) {
  if (/^eu-notice-[a-z]{2}\.jpg$/.test(f)) problems.push(`Veraltet: assets/${f} (EUR-Lex-Raster, durch offizielle PNG ersetzt)`);
}
for (const f of ["garan-full-template.png", "garan-nested-template.png", "eu-warranty-fonts.css"]) {
  if (!existsSync(`${dir}/assets/${f}`)) problems.push(`Fehlt: assets/${f}`);
}

// 2. Texte, Maße und Links je Sprachfassung (snippets/euw-lang.liquid)
const snippet = readFileSync(`${dir}/snippets/euw-lang.liquid`, "utf8");
const keys = [...snippet.matchAll(/^ {2}(\d+) (\w+)$/gm)].map((m) => m[2]);
for (const l of langs) {
  // Englisch ist zugleich die Rückfallfassung (else-Zweig)
  const line = snippet.match(l === "en" ? /\{%- else -%\}(.*)/ : new RegExp(`\\{%- when '${l}' -%\\}(.*)`))?.[1];
  if (!line) { problems.push(`euw-lang.liquid: Sprachfassung ${l} fehlt`); continue; }
  const v = Object.fromEntries(line.split("§").map((val, i) => [keys[i], val]));
  for (const k of keys) if (!v[k]) problems.push(`euw-lang.liquid: ${l}.${k} leer`);
  if (v.notice_url !== `https://europa.eu/youreurope/${NOTICE_URLS[l]}`) problems.push(`euw-lang.liquid: ${l}.notice_url ${v.notice_url} weicht von den Leitlinien ab`);
  if (v.garan_url !== GARAN_URL) problems.push(`euw-lang.liquid: ${l}.garan_url ${v.garan_url} weicht vom QR-Ziel des GARAN-Labels ab`);
  if (v.lang !== l) problems.push(`euw-lang.liquid: ${l}.lang ist ${v.lang}`);
  const file = `${dir}/assets/eu-notice-${l}.png`;
  if (existsSync(file)) {
    const { width, height } = await sharp(file).metadata();
    if (v.dims !== `${width}x${height}`) problems.push(`euw-lang.liquid: ${l}.dims ${v.dims}, Grafik ist ${width}x${height}`);
  }
}
for (const k of ["text", "title", "sentence_neutral", "notice_url", "garan_url", "garan_term", "garan_years"]) {
  if (!keys.includes(k)) problems.push(`euw-lang.liquid: Schlüssel ${k} fehlt in der Indexliste`);
}
// Der Block greift per Index zu: Indizes müssen zur Liste im Snippet passen
const liquidFiles = ["blocks", "snippets"].flatMap((d) => readdirSync(`${dir}/${d}`).filter((f) => f.endsWith(".liquid")).map((f) => `${dir}/${d}/${f}`));
const block = liquidFiles.filter((f) => !f.endsWith("euw-lang.liquid")).map((f) => readFileSync(f, "utf8")).join("\n");
const expectIndex = { dims: 0, notice_url: 1, notice_url_label: 2, garan_url: 3, garan_url_label: 4, title: 5, text: 6, sentence_neutral: 7,
  sentence_formal: 8, sentence_informal: 9, garan_term: 10, garan_years: 11, enlarge: 12, dialog: 13, zoom_in: 14, zoom_out: 15, close: 16, lang: 17 };
for (const [k, i] of Object.entries(expectIndex)) {
  if (keys[i] !== k) problems.push(`euw-lang.liquid: Index ${i} ist ${keys[i]}, Block erwartet ${k}`);
  if (!block.includes(`texts[${i}]`)) problems.push(`Kein Block/Snippet nutzt ${k} (texts[${i}])`);
}

// 3. GARAN-Geometrie im Snippet = offizielle Vorlage (app/lib/garan-geometry.json, auch Basis der Breitenprüfung)
const g = JSON.parse(readFileSync("app/lib/garan-geometry.json", "utf8"));
const garan = readFileSync(`${dir}/snippets/garan-label.liquid`, "utf8");
const expect = [
  `viewBox="0 0 ${g.full.viewBox.join(" ")}"`,
  `<text x="${g.full.brand.x}" y="${g.full.brand.y}" font-size="${g.full.brand.size}"`,
  `<text x="${g.full.model.xEnd}" y="${g.full.model.y}" font-size="${g.full.model.size}"`,
  `<text x="{{ yx }}" y="${g.full.years.y}" font-size="${g.full.years.size}" font-weight="800" letter-spacing="${+(g.full.years.letterSpacing * g.full.years.size).toFixed(2)}"`,
  `viewBox="0 0 ${g.nested.viewBox.join(" ")}"`,
  `<text x="{{ nx }}" y="${g.nested.years.y}" font-size="${g.nested.years.size}" font-weight="800" letter-spacing="${+(g.nested.years.letterSpacing * g.nested.years.size).toFixed(2)}"`,
  // Anker je letzter Ziffer (Abstand zum Kalendersymbol wie "XX" in der Vorlage)
  ...[..."0123456789"].map((d) => `when '${d}'\n      assign yx = ${g.full.years.anchors[d]}\n      assign nx = ${g.nested.years.anchors[d]}`),
];
for (const e of expect) if (!garan.includes(e)) problems.push(`garan-label.liquid weicht von der Vorlage ab, erwartet: ${e}`);

// 4. Plattformgrenze: höchstens 100 KB Liquid in der Theme-App-Extension (Shopify prüft beim Deploy)
const liquidBytes = liquidFiles.reduce((sum, f) => sum + statSync(f).size, 0);
if (liquidBytes > 100 * 1024) problems.push(`Liquid insgesamt ${(liquidBytes / 1024).toFixed(1)} KB, erlaubt sind 100 KB`);
else if (liquidBytes > 90 * 1024) console.warn(`Hinweis: Liquid insgesamt ${(liquidBytes / 1024).toFixed(1)} KB von 100 KB`);

if (problems.length) {
  console.error("Nicht release-fähig:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Amtliche Vorlagen vollständig: 24 Sprachfassungen mit Texten, Maßen und Links, GARAN-Geometrie stimmt (Liquid ${(liquidBytes / 1024).toFixed(1)} von 100 KB).`);
