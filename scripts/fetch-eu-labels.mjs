// Amtliche Grafiken der VO (EU) 2025/1960 aus den offiziellen Dateien der Kommission (Praxisleitlinien, April 2026):
// https://commission.europa.eu/publications/practical-guidelines-and-high-resolution-vector-files-eu-notice-and-label-product-guarantees_en
//
//   node scripts/fetch-eu-labels.mjs download   -> legal-sources/commission/<archiv>/ (per .gitignore ausgeschlossen)
//   node scripts/fetch-eu-labels.mjs texts      -> scripts/i18n/notice-text.json (amtlicher Mitteilungstext, braucht pdftotext/poppler)
//   node scripts/fetch-eu-labels.mjs build      -> Shop-Grafiken, Schrift, Texte/Maße/Links je Sprache, GARAN-Geometrie
//
// Mitteilung: offizielles RGB-PNG (A4-Seite) je Sprache; die Mitteilung ist randlos gestaltet, entfernt wird nur der
// leere Seitenbereich unterhalb, die Mitteilung selbst bleibt unverändert. Englisch fehlt im PNG-Archiv und wird aus dem offiziellen SVG
// in derselben Auflösung (200 dpi) gerastert.
// GARAN: offizielle SVG-Vorlagen; entfernt werden nur die drei editierbaren Textfelder (XX, Brand/Trademark,
// Model identifier). Der Shop setzt sie an den Originalkoordinaten in Inter wieder ein.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { unzipSync } from "fflate";
import * as fontkit from "fontkit";

const LANGS = "bg,cs,da,de,el,en,es,et,fi,fr,ga,hr,hu,it,lt,lv,mt,nl,pl,pt,ro,sk,sl,sv".split(",");
const SRC = "legal-sources/commission";
const EXT = "extensions/eu-warranty-label";
const ASSETS = `${EXT}/assets`;
const FONTS = "node_modules/@fontsource/inter/files";

const ARCHIVES = {
  "notice-png-jpg": "dbd46ba2-77d2-4a74-ad52-120bc7bf02ea_en?filename=PNG%20and%20JPG.zip",
  "notice-svg": "27c45f1f-78a1-47a7-a7cc-adf23afee5ea_en?filename=SVG.zip",
  "notice-pdf": "29acbfc0-a26e-4c21-85af-8bc2b167103e_en?filename=Harmonised%20notice%20in%2024%20languages%20colour%20and%20black%20and%20white_0.zip",
  "garan-web": "435fbeb1-fccc-4ead-bfa9-96625962ba09_en?filename=GARAN%20label%20for%20website.zip",
};

// Ziel des QR-Codes je Sprachfassung (Praxisleitlinien 2.3): muss im Shop zusätzlich als klickbarer Link stehen
const NOTICE_URLS = {
  bg: "europa.eu/youreurope/гаранции", cs: "europa.eu/youreurope/záruky_cs", da: "europa.eu/youreurope/garantier",
  de: "europa.eu/youreurope/garantien", el: "europa.eu/youreurope/εγγυήσεις", en: "europa.eu/youreurope/guarantees",
  es: "europa.eu/youreurope/garantías", et: "europa.eu/youreurope/garantiid", fi: "europa.eu/youreurope/virhevastuu",
  fr: "europa.eu/youreurope/garanties", ga: "europa.eu/youreurope/ráthaíochtaí", hr: "europa.eu/youreurope/jamstva_hr",
  hu: "europa.eu/youreurope/jótállás", it: "europa.eu/youreurope/garanzie", lt: "europa.eu/youreurope/garantijos",
  lv: "europa.eu/youreurope/garantijas", mt: "europa.eu/youreurope/garanziji", nl: "europa.eu/youreurope/garantie",
  pl: "europa.eu/youreurope/gwarancje", pt: "europa.eu/youreurope/garantias", ro: "europa.eu/youreurope/garanții",
  sk: "europa.eu/youreurope/záruky_sk", sl: "europa.eu/youreurope/jamstva_sl", sv: "europa.eu/youreurope/reklamationsrätt",
};

// Ziel des QR-Codes im GARAN-Label (Praxisleitlinien 3.1 iii)
const GARAN_URL = "europa.eu/youreurope/commercial-guarantee-durability/index.htm";

async function download() {
  await mkdir(SRC, { recursive: true });
  for (const [name, id] of Object.entries(ARCHIVES)) {
    const res = await fetch(`https://commission.europa.eu/document/download/${id}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const zip = new Uint8Array(await res.arrayBuffer());
    await writeFile(path.join(SRC, `${name}.zip`), zip);
    for (const [file, data] of Object.entries(unzipSync(zip))) {
      if (file.endsWith("/") || file.startsWith("__MACOSX") || file.endsWith(".DS_Store")) continue;
      const out = path.join(SRC, name, file);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, data);
    }
    console.log(`✓ ${name}`);
  }
}

/** Rendert ein SVG (Einheiten = px bei 72 dpi) auf die gewünschte Pixelbreite. */
async function rasterSvg(svg, viewBoxWidth, widthPx) {
  // width/height in mm (Illustrator-Export) würden die Dichte doppelt anwenden -> nur viewBox (px) verwenden
  const px = String(svg).replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, ""));
  return sharp(Buffer.from(px), { density: (72 * widthPx) / viewBoxWidth }).flatten({ background: "#ffffff" });
}

async function buildNotices() {
  const meta = {};
  for (const lang of LANGS) {
    const L = lang.toUpperCase();
    const png = path.join(SRC, "notice-png-jpg/PNG", `Legal guarantee_notice_${L}.png`);
    let src;
    if (existsSync(png)) src = sharp(png);
    else {
      const svg = await readFile(path.join(SRC, "notice-svg", `Legal guarantee_notice ${L}.svg`));
      src = await rasterSvg(svg, (await sharp(svg).metadata()).width, 1654); // gleiche Auflösung wie die PNGs (A4, 200 dpi)
    }
    const { data, info } = await src.flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
    // Die Mitteilung ist randlos gestaltet und beginnt oben auf der A4-Seite; nur den leeren Seitenbereich darunter entfernen
    let last = info.height - 1;
    scan: for (; last > 0; last--) {
      for (let x = 0; x < info.width; x++) {
        const i = (last * info.width + x) * info.channels;
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) break scan;
      }
    }
    const height = Math.min(info.height, last + 1 + 40);
    const width = info.width;
    const trimmed = await sharp(data, { raw: info }).extract({ left: 0, top: 0, width, height }).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(path.join(ASSETS, `eu-notice-${lang}.png`), trimmed);
    meta[lang] = { width, height, url: NOTICE_URLS[lang] };
    console.log(`✓ eu-notice-${lang}.png ${width}×${height}${existsSync(png) ? "" : " (aus SVG)"}`);
  }
  for (const f of await readdir(ASSETS)) if (/^eu-notice-[a-z]{2}\.jpg$/.test(f)) await rm(path.join(ASSETS, f));

  return meta;
}

/** Amtlicher Mitteilungstext je Sprache aus den PDFs der Kommission (für Screenreader, gleiche Fassung wie die Grafik). */
async function extractTexts() {
  const out = {};
  for (const lang of LANGS) {
    const pdf = path.join(SRC, "notice-pdf", `Legal guarantee_notice ${lang.toUpperCase()}N.pdf`);
    const raw = execFileSync("pdftotext", ["-l", "1", "-enc", "UTF-8", pdf, "-"], { encoding: "utf8" });
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\f/g, "").trim()).filter(Boolean);
    const titleLines = [];
    for (const l of lines) { if (/\p{L}/u.test(l) && l === l.toLocaleUpperCase(lang)) titleLines.push(l); else break; }
    out[lang] = {
      title: titleLines.join(" "),
      text: lines.slice(titleLines.length).join(" ").replace(/\s+/g, " ").trim(),
    };
  }
  await writeFile("scripts/i18n/notice-text.json", JSON.stringify(out, null, 2) + "\n");
  console.log("✓ scripts/i18n/notice-text.json");
}

// Reihenfolge der Werte im Snippet euw-lang (Index = Position nach split: '§'); Aufrufer verwenden diese Indizes
const LANG_KEYS = ["dims", "notice_url", "notice_url_label", "garan_url", "garan_url_label", "title", "text",
  "sentence_neutral", "sentence_formal", "sentence_informal", "garan_term", "garan_years",
  "enlarge", "dialog", "zoom_in", "zoom_out", "close", "lang"];

/** Snippet mit allen Shop-Texten, Maßen und Links je Sprachfassung, als eine '§'-getrennte Zeile je Sprache. */
async function buildLang(meta) {
  const ui = JSON.parse(await readFile("scripts/i18n/storefront.json", "utf8"));
  const texts = JSON.parse(await readFile("scripts/i18n/notice-text.json", "utf8"));
  const line = (lang) => {
    const values = {
      dims: `${meta[lang].width}x${meta[lang].height}`,
      notice_url: `https://${meta[lang].url}`,
      notice_url_label: meta[lang].url,
      garan_url: `https://${GARAN_URL}`,
      garan_url_label: GARAN_URL.replace(/\/index\.htm$/, ""),
      lang,
      title: texts[lang].title,
      text: texts[lang].text,
      ...ui[lang],
    };
    return LANG_KEYS.map((k) => {
      const v = values[k];
      if (!v) throw new Error(`${lang}: ${k} fehlt`);
      if (/\{[{%]|[%}]\}|§/.test(v)) throw new Error(`${lang}.${k}: Liquid-Syntax oder § im Text`);
      return v;
    }).join("§");
  };
  await writeFile(path.join(EXT, "snippets/euw-lang.liquid"),
    "{%- comment -%} Generiert von scripts/fetch-eu-labels.mjs build aus scripts/i18n/*.json – nicht von Hand ändern.\n" +
    "  Liefert alle Werte einer amtlichen Sprachfassung, getrennt durch §. Sprache: Parameter lang, sonst die der\n" +
    "  Kund:innen (request.locale); ohne amtliche Fassung Englisch. Index:\n" +
    LANG_KEYS.map((k, i) => `  ${i} ${k}`).join("\n") + "\n{%- endcomment -%}\n" +
    "{%- liquid\n  assign l = lang\n  if l == blank\n    assign l = request.locale.iso_code | slice: 0, 2 | downcase\n  endif\n-%}\n" +
    `{%- case l -%}\n${LANGS.filter((l) => l !== "en").map((l) => `{%- when '${l}' -%}${line(l)}`).join("\n")}\n` +
    `{%- else -%}${line("en")}\n{%- endcase -%}\n`);
  const old = path.join(EXT, "snippets/euw-notice-meta.liquid");
  if (existsSync(old)) await rm(old);
  console.log("✓ snippets/euw-lang.liquid");

  // Dieselben Werte für Checkout-Extension und Bestellbestätigung (app/lib/publish.server.ts schreibt sie ins
  // Shop-Metafield "notice"); '|' und '§' trennen dort die Felder
  const SERVER_KEYS = ["dims", "notice_url", "notice_url_label", "title", "sentence_neutral", "sentence_formal",
    "sentence_informal", "garan_term", "garan_years", "garan_url", "garan_url_label", "enlarge"];
  const server = Object.fromEntries(LANGS.map((l) => {
    const values = line(l).split("§");
    return [l, Object.fromEntries(SERVER_KEYS.map((k) => {
      const v = values[LANG_KEYS.indexOf(k)];
      if (/[|§]/.test(v)) throw new Error(`${l}.${k}: '|' im Text`);
      return [k, v];
    }))];
  }));
  await writeFile("app/lib/storefront-texts.json", JSON.stringify(server, null, 1) + "\n");
  console.log("✓ app/lib/storefront-texts.json");
}

/** Text-Element (Klasse + Position) und Schriftangaben aus einer Illustrator-SVG lesen. */
function readTextField(svg, content) {
  const m = svg.match(new RegExp(`<text class="([^"]+)" transform="translate\\(([\\d.]+) ([\\d.]+)\\)">(?:<tspan[^>]*>)?${content}`));
  if (!m) throw new Error(`Textfeld "${content}" nicht gefunden`);
  // Alle Regeln mit dieser Klasse zusammenführen (Illustrator verteilt Schrift und Farbe auf Sammelregeln)
  const style = svg.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\s+/g, " ");
  const css = [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel]) => sel.split(",").map((s) => s.trim()).includes(`.${m[1]}`)).map(([, , decl]) => decl).join(";");
  const size = Number(css.match(/font-size: ([\d.]+)px/)[1]);
  const ls = Number(css.match(/letter-spacing: (-?[\d.]+)em/)?.[1] ?? 0);
  return { x: Number(m[2]), y: Number(m[3]), size, letterSpacing: ls };
}

async function buildGaran(fonts) {
  const full = await readFile(path.join(SRC, "garan-web/GARAN Label_colour.svg"), "utf8");
  const nested = await readFile(path.join(SRC, "garan-web/GARAN Label_nested display.svg"), "utf8");
  const viewBox = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  const strip = (svg) => svg.replace(/<text[\s\S]*?<\/text>/g, "");

  const [fw, fh] = viewBox(full);
  const [nw, nh] = viewBox(nested);
  await (await rasterSvg(strip(full), fw, 1100)).png({ compressionLevel: 9 }).toFile(path.join(ASSETS, "garan-full-template.png"));
  await (await rasterSvg(strip(nested), nw, 1110)).png({ compressionLevel: 9 }).toFile(path.join(ASSETS, "garan-nested-template.png"));
  for (const f of ["garan-full-template.jpg", "garan-nested-template.jpg"]) if (existsSync(path.join(ASSETS, f))) await rm(path.join(ASSETS, f));

  // Freie Fläche links der Jahreszahl bis zum Rahmen, gemessen in der Vorlage ohne Textfelder
  const innerLeft = async (svg, w, y0, y1) => {
    const scale = 10;
    const { data, info } = await (await rasterSvg(strip(svg), w, w * scale)).greyscale().raw().toBuffer({ resolveWithObject: true });
    for (let x = Math.round(12 * scale); x > 0; x--) {
      for (let y = Math.round(y0 * scale); y < Math.round(y1 * scale); y++) if (data[y * info.width + x] < 160) return (x + 1) / scale;
    }
    return 0;
  };
  const xxEnd = (field) => field.x + fonts.measure("XX", "extrabold", field.size, field.letterSpacing);

  // Abstand Dauer -> Kalendersymbol wie in der Vorlage: Kalender in der Vorlage ohne Text, Kontur von "XX" in der
  // offiziellen Grafik (JPG der Kommission), jeweils auf Kalenderhöhe gemessen. Jede Ziffer wird so verankert, dass ihre
  // Kontur dort endet, wo die von "XX" endet (rechtsbündig wie im Beispiel der Kommission, Leitlinien 3.1).
  const darkAt = async (file, w, rasterSvgSource) => {
    const img = rasterSvgSource ? await rasterSvg(rasterSvgSource, w, w * 10) : sharp(file);
    const { data, info } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });
    const s = info.width / w;
    return (x, y) => data[Math.round(y * s) * info.width + Math.round(x * s)] < 140;
  };
  const xb = fontkit.create(await readFile(path.join(FONTS, "inter-latin-800-normal.woff2")));
  const digitAnchors = async (svg, officialJpg, w, field) => {
    const T = await darkAt(null, w, strip(svg));
    const O = await darkAt(path.join(SRC, "garan-web", officialJpg), w);
    const capTop = field.y - field.size * 0.727;
    let calLeft = null;
    for (let x = field.x + 2; x < field.x + 3 * field.size && calLeft === null; x += 0.05)
      for (let y = capTop; y < field.y; y += 0.1) if (T(x, y)) { calLeft = x; break; }
    let calTop = null;
    for (let y = capTop; y < field.y && calTop === null; y += 0.05)
      for (let x = calLeft; x < calLeft + 0.3 * field.size; x += 0.2) if (T(x, y)) { calTop = y; break; }
    let inkRight = 0;
    for (let y = calTop; y < field.y; y += 0.1)
      for (let x = calLeft - 0.3; x > field.x; x -= 0.05) if (O(x, y)) { inkRight = Math.max(inkRight, x); break; }
    // text-anchor="end" schließt den letzten Buchstabenabstand ein: Konturende = Anker - rechter Weißraum - Abstand
    const anchors = {};
    for (const d of "0123456789") {
      const g = xb.glyphForCodePoint(d.codePointAt(0));
      const rsb = ((g.advanceWidth - g.bbox.maxX) / xb.unitsPerEm) * field.size;
      anchors[d] = +(inkRight + rsb + field.letterSpacing * field.size).toFixed(2);
    }
    return { calendarLeft: +calLeft.toFixed(2), inkRight: +inkRight.toFixed(2), anchors };
  };

  const years = readTextField(full, "XX");
  const brand = readTextField(full, "Brand/");
  const model = readTextField(full, "Model identifier");
  // Trennlinie unter dem Titel = Satzbreite: Marke beginnt an ihrem Anfang, Modellkennung endet an ihrem Ende
  const rule = svg => svg.match(/<line [^>]*x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)"/).slice(1).map(Number);
  const [ruleX1, , ruleX2] = rule(full);
  const nYears = readTextField(nested, "XX");
  const geometry = {
    source: "Kommission, GARAN label for website (offizielle SVG), Praxisleitlinien April 2026",
    full: {
      viewBox: [fw, fh],
      years: { xEnd: +xxEnd(years).toFixed(2), y: years.y, size: years.size, letterSpacing: years.letterSpacing,
        minX: +((await innerLeft(full, fw, years.y - years.size * 0.73, years.y)) + 1).toFixed(2),
        ...(await digitAnchors(full, "GARAN Label_colour.jpg", fw, years)) },
      brand: { x: brand.x, y: brand.y, size: brand.size },
      model: { xEnd: ruleX2, y: model.y, size: model.size,
        placeholderEnd: +(model.x + fonts.measure("Model identifier", "regular", model.size)).toFixed(2) },
      rule: [ruleX1, ruleX2],
      minGap: brand.size, // mindestens eine Schrifthöhe Abstand zwischen Marke und Modell
    },
    nested: {
      viewBox: [nw, nh],
      years: { xEnd: +xxEnd(nYears).toFixed(2), y: nYears.y, size: nYears.size, letterSpacing: nYears.letterSpacing,
        minX: +((await innerLeft(nested, nw, nYears.y - nYears.size * 0.73, nYears.y)) + 1).toFixed(2),
        ...(await digitAnchors(nested, "GARAN Label_nested_display.jpg", nw, nYears)) },
    },
  };
  await writeFile("app/lib/garan-geometry.json", JSON.stringify(geometry, null, 2) + "\n");
  console.log("✓ garan-full-template.png, garan-nested-template.png, app/lib/garan-geometry.json");
  return geometry;
}

/** Inter aus @fontsource: Laufweiten-Tabelle (app/lib/inter-metrics.json) und eingebettete Shop-Schrift. */
async function buildFonts() {
  const subsets = {
    regular: ["latin", "latin-ext", "greek", "cyrillic"].map((s) => ({ s, file: `inter-${s}-400-normal.woff2`, weight: 400 })),
    extrabold: [{ s: "latin", file: "inter-latin-800-normal.woff2", weight: 800 }],
  };
  const css400 = await readFile("node_modules/@fontsource/inter/400.css", "utf8");
  const range = (s) => css400.match(new RegExp(`inter-${s}-400-normal\\.woff2[\\s\\S]*?unicode-range: ([^;]+);`))[1];

  const metrics = { unitsPerEm: 0, regular: {}, extrabold: {} };
  const faces = [];
  for (const [style, list] of Object.entries(subsets)) {
    for (const { s, file, weight } of list) {
      const buf = await readFile(path.join(FONTS, file));
      const font = fontkit.create(buf);
      metrics.unitsPerEm = font.unitsPerEm;
      for (const cp of font.characterSet) {
        const adv = font.glyphForCodePoint(cp).advanceWidth;
        if (!(cp in metrics[style])) metrics[style][cp] = adv;
      }
      faces.push(`@font-face{font-family:'EUInter';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2');unicode-range:${range(s)}}`);
    }
  }
  await writeFile("app/lib/inter-metrics.json", JSON.stringify(metrics) + "\n");
  await writeFile(path.join(ASSETS, "eu-warranty-fonts.css"),
    "/* Inter (SIL Open Font License, @fontsource/inter), eingebettet: Theme-Extensions erlauben keine Font-Dateien.\n" +
    "   Generiert von scripts/fetch-eu-labels.mjs build aus denselben Dateien wie app/lib/inter-metrics.json (Breitenprüfung).\n" +
    "   Lädt nur, wenn ein GARAN-Label angezeigt wird (snippets/garan-label.liquid). */\n" + faces.join("\n") + "\n");
  console.log("✓ app/lib/inter-metrics.json, assets/eu-warranty-fonts.css");

  const measure = (text, style, size, letterSpacing = 0) => {
    let w = 0;
    for (const ch of text) w += metrics[style][ch.codePointAt(0)] ?? NaN;
    return (w / metrics.unitsPerEm) * size + letterSpacing * size * [...text].length;
  };
  return { measure };
}

const [cmd] = process.argv.slice(2);
if (cmd === "download") await download();
else if (cmd === "texts") await extractTexts();
else if (cmd === "build") {
  const fonts = await buildFonts();
  const meta = await buildNotices();
  await buildLang(meta);
  await buildGaran(fonts);
  console.log("\nJetzt: node scripts/check-legal.mjs");
} else console.log("Nutzung:\n  node scripts/fetch-eu-labels.mjs download\n  node scripts/fetch-eu-labels.mjs texts\n  node scripts/fetch-eu-labels.mjs build");
