// Checkout-Extension und Bestellbestätigung: Datensatz-Format, Varianten-Logik, gerendertes GARAN-Bild, Mail-Baustein.
// Ohne Datenbank (vite-node, siehe package.json "test").
import assert from "node:assert/strict";
import { Liquid } from "liquidjs";
import sharp from "sharp";
import { emailSnippet } from "../app/lib/email-snippet";
import { NOTICE_FIELDS, NOTICE_LANGS, garanLabel, noticeValue } from "../app/lib/publish.server";
import { renderGaranPng } from "../app/lib/render.server";
import geometry from "../app/lib/garan-geometry.json";
import * as ext from "../extensions/eu-warranty-checkout/src/shared";

const results: string[] = [];
const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); results.push("✓ " + name); };

const img = (lang: string) => `https://cdn.shopify.com/s/files/1/0001/files/eu-gewaehrleistung-mitteilung-${lang}.png?v=17`;
const NOTICE = noticeValue(new Map(NOTICE_LANGS.map((l) => [l, img(l)])));
const mf = (value: string) => ({ value });

await t("Feldreihenfolge Server = Checkout-Extension", () => {
  assert.deepEqual([...ext.NOTICE_FIELDS], [...NOTICE_FIELDS]);
});

await t("notice: 24 Datensätze, Englisch zuerst, URLs kodiert, keine Trennzeichen in Feldern", () => {
  const records = NOTICE.split("§").map((r) => r.split("|"));
  assert.equal(records.length, 24);
  assert.equal(records[0][0], "en");
  for (const r of records) assert.equal(r.length, NOTICE_FIELDS.length);
  const bg = records.find((r) => r[0] === "bg")!;
  assert.equal(bg[2], "https://europa.eu/youreurope/%D0%B3%D0%B0%D1%80%D0%B0%D0%BD%D1%86%D0%B8%D0%B8");
  assert.equal(bg[3], "europa.eu/youreurope/гаранции");
});

await t("Extension: Sprachwahl, Rückfall Englisch, nichts ohne Metafield", () => {
  const entries = [{ target: { type: "shop", id: "gid://shopify/Shop/1" }, metafield: { key: "notice", value: NOTICE } }];
  const de = ext.noticeRecord(entries, "de-AT")!;
  assert.equal(de.lang, "de");
  assert.equal(de.image, img("de"));
  assert.equal(ext.sentence(de, "formal"), "Ihre Rechte aus der gesetzlichen Gewährleistung");
  assert.equal(ext.sentence(de, undefined), "Rechte aus der gesetzlichen Gewährleistung");
  assert.equal(ext.aspectRatio(de.dims), "1654/2283");
  assert.equal(ext.noticeRecord(entries, "ja")!.lang, "en");
  assert.equal(ext.noticeRecord([], "de"), null);
});

await t("Extension: GARAN der Variante vor Produkt, 'none' ohne Label, GID und Zahl", () => {
  const e = (type: string, id: string, value: string) => ({ target: { type, id }, metafield: { key: "garan_image", value } });
  const entries = [e("product", "gid://shopify/Product/1", "P1"), e("variant", "11", "V11"), e("variant", "gid://shopify/ProductVariant/12", "none")];
  assert.equal(ext.garanImage(entries, "gid://shopify/Product/1", "gid://shopify/ProductVariant/11"), "V11");
  assert.equal(ext.garanImage(entries, "gid://shopify/Product/1", "gid://shopify/ProductVariant/12"), null);
  assert.equal(ext.garanImage(entries, "gid://shopify/Product/1", "gid://shopify/ProductVariant/13"), "P1");
  assert.equal(ext.garanImage(entries, "gid://shopify/Product/2", "gid://shopify/ProductVariant/21"), null);
});

await t("garanLabel: nur bestätigt, > 2 Jahre, Marke + Modell, passend", () => {
  const m = (confirmed: string, duration: string, brand = "Miele", model = "WWD 320") =>
    ({ confirmed: mf(confirmed), duration: mf(duration), brand: mf(brand), model: mf(model) });
  assert.deepEqual(garanLabel(m("true", "5.0")), { years: "5", brand: "Miele", model: "WWD 320" });
  assert.equal(garanLabel(m("false", "5")), null);
  assert.equal(garanLabel(m("true", "2")), null);
  assert.equal(garanLabel(m("true", "5", "")), null);
  assert.equal(garanLabel(m("true", "5", "Miele", "M".repeat(60))), null); // passt nicht in die Zeile
  assert.equal(garanLabel({ confirmed: null, duration: mf("5"), brand: mf("A"), model: mf("B") }), null);
});

// Konturen im gerenderten Bild messen (Einheiten der offiziellen Vorlage)
async function ink(png: Buffer) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const s = info.width / geometry.full.viewBox[0];
  const dark = (x: number, y: number) => data[Math.round(y * s) * info.width + Math.round(x * s)] < 128;
  const span = (x0: number, x1: number, y0: number, y1: number) => {
    let min = Infinity, max = -Infinity;
    for (let y = y0; y <= y1; y += 0.1) for (let x = x0; x <= x1; x += 0.05) if (dark(x, y)) { min = Math.min(min, x); max = Math.max(max, x); }
    return { min, max };
  };
  return { info, span };
}

await t("GARAN-Bild: Vorlagengröße, Marke/Modell an der Linie, Dauer mit Konturabstand wie XX", async () => {
  const g = geometry.full;
  for (const years of ["3", "7", "10"]) {
    const { info, span } = await ink(await renderGaranPng({ years, brand: "Bosch Hausgeräte", model: "WAX32M40" }));
    assert.equal(info.width, 1100);
    assert.equal(info.height, 1158);
    const brand = span(g.rule[0] - 2, 130, g.brand.y - 6, g.brand.y);
    assert.ok(brand.min >= g.brand.x && brand.min < g.brand.x + 1.5, `Marke beginnt bei ${brand.min}`);
    const model = span(150, g.model.xEnd + 1.2, g.model.y - 6, g.model.y); // Rahmen der Vorlage liegt bei ≈ 266
    assert.ok(model.max <= g.model.xEnd + 0.3 && model.max > g.model.xEnd - 1.5, `Modell endet bei ${model.max}`);
    const y = span(g.years.minX, g.years.calendarLeft - 0.3, g.years.y - g.years.size * 0.6, g.years.y - 1);
    assert.ok(Math.abs(y.max - g.years.inkRight) < 0.6, `${years}: Kontur endet bei ${y.max}, XX bei ${g.years.inkRight}`);
  }
});

// Mail-Baustein in einer Liquid-Umgebung wie die Benachrichtigungen von Shopify (ohne Theme-Filter)
const NS = "app--4242--eu_warranty";
const engine = new Liquid();
const line = (title: string, variant: string, p?: string, v?: string) => ({
  title,
  variant: { title: variant, metafields: { [NS]: v === undefined ? {} : { garan_image: mf(v) } } },
  product: { metafields: { [NS]: p === undefined ? {} : { garan_image: mf(p) } } },
});
const mail = (ctx: object, address: "neutral" | "formal" | "informal" = "formal") => engine.parseAndRender(emailSnippet("4242", address), ctx);
const lines = [
  line("Waschmaschine", "Default Title", "https://cdn/garan-a.png"),
  line("Trockner", "Weiß", "https://cdn/garan-b.png", "none"),
  line("Kühlschrank", "Groß", "https://cdn/garan-c.png", "https://cdn/garan-c-gross.png"),
  line("Socken", "M"),
];

await t("Mail: Sprache der Bestellung, Satz, Link, GARAN je Position (Variante/none/erbt)", async () => {
  const html = await mail({ shop: { metafields: { [NS]: { notice: mf(NOTICE) } } }, order: { customer_locale: "de" }, line_items: lines });
  assert.match(html, /lang="de"/);
  assert.ok(html.includes(img("de").replace(/&/g, "&amp;")));
  assert.match(html, />Ihre Rechte aus der gesetzlichen Gewährleistung</);
  assert.match(html, /href="https:\/\/europa\.eu\/youreurope\/garantien"/);
  assert.ok(html.includes("garan-a.png") && html.includes("garan-c-gross.png"));
  assert.ok(!html.includes("garan-b.png") && !html.includes("garan-c.png\""));
  assert.equal(html.match(/alt="GARAN/g)?.length, 2);
  assert.match(html, />Kühlschrank – Groß</);
  assert.ok(!html.includes("Default Title"));
  assert.match(html, /Gewerbliche Haltbarkeitsgarantie: <a href="https:\/\/europa\.eu\/youreurope\/commercial-guarantee-durability\/index\.htm"/);
});

await t("Mail: Rückfall Englisch, Metafield als Text, ohne Metafield leer", async () => {
  const en = await mail({ shop: { metafields: { [NS]: { notice: NOTICE } } }, customer_locale: "ja-JP", line_items: [] }, "neutral");
  assert.match(en, /lang="en"/);
  assert.match(en, />Legal guarantee rights</);
  const none = await mail({ shop: { metafields: {} }, order: { customer_locale: "de" }, line_items: lines });
  assert.equal(none.trim(), "");
});

await t("Mail: App-ID wird geprüft", () => {
  assert.throws(() => emailSnippet("gid://shopify/App/1"));
});

console.log(results.join("\n"));
console.log(`\n${results.length} Prüfungen bestanden`);
