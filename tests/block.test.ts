import assert from "node:assert/strict";
import { blockContext, createEngine, renderBlock } from "../scripts/liquid-engine.mjs";
import geometry from "../app/lib/garan-geometry.json";

const engine = createEngine();
const render = (opts: Record<string, unknown>, file = "eu-warranty") => renderBlock(engine, file, blockContext(opts)) as Promise<string>;
const GARAN = { garan_confirmed: true, garan_duration: 3, garan_brand: "Maik Hansen", garan_model: "MH0087899" };

const ok: string[] = [];
const t = async (name: string, fn: () => Promise<void>) => { await fn(); ok.push("✓ " + name); };

await t("Mitteilung shopweit: ohne Produktauswahl, mit Satz-Toggle und Your-Europe-Link", async () => {
  const html = await render({});
  assert.match(html, /<details class="euw-notice euw-notice--collapsed"/);
  assert.match(html, /Rechte aus der gesetzlichen Gewährleistung/);
  assert.match(html, /href="https:\/\/europa\.eu\/youreurope\/garantien"/);
});
await t("Nur B2B: nichts wird angezeigt", async () => {
  assert.equal((await render({ settings: { b2bOnly: true }, metafields: GARAN })).trim(), "");
});
await t("Ausgeschlossene Kollektion: nichts wird angezeigt, andere Kollektionen nicht betroffen", async () => {
  const settings = { excludeCollectionIds: ["123"] };
  assert.equal((await render({ settings, product: { collections: [{ id: 5 }, { id: 123 }] } })).trim(), "");
  assert.notEqual((await render({ settings, product: { collections: [{ id: 5 }] } })).trim(), "");
});
await t("Produkt ausgeschlossen, Gutschein, ohne Versand, Tag: nichts wird angezeigt", async () => {
  assert.equal((await render({ metafields: { exclude: true } })).trim(), "");
  assert.equal((await render({ product: { "gift_card?": true } })).trim(), "");
  assert.equal((await render({ product: { selected_or_first_available_variant: { requires_shipping: false } } })).trim(), "");
  assert.equal((await render({ settings: { excludeTags: ["b2b"] }, product: { tags: ["B2B"] } })).trim(), "");
});
await t("GARAN nur mit Bestätigung, Dauer über 2 Jahre und Marke/Modell", async () => {
  assert.match(await render({ metafields: GARAN }), /data-euw-garan/);
  assert.doesNotMatch(await render({ metafields: { ...GARAN, garan_confirmed: false } }), /data-euw-garan/);
  assert.doesNotMatch(await render({ metafields: { ...GARAN, garan_duration: 2 } }), /data-euw-garan/);
  assert.doesNotMatch(await render({ metafields: { ...GARAN, garan_model: "" } }), /data-euw-garan/);
});
await t("Dauer am Ziffernanker (Abstand zum Kalender wie XX), halbe Jahre mit Komma", async () => {
  const html = await render({ metafields: GARAN });
  assert.ok(html.includes(`<text x="${geometry.full.years.anchors["3"]}" y="150.57"`), "volles Label");
  assert.ok(html.includes(`<text x="${geometry.nested.years.anchors["3"]}" y="46.65"`), "geschachtelt");
  const half = await render({ metafields: { ...GARAN, garan_duration: 4.5 } });
  assert.match(half, />4,5<\/text>/);
  assert.ok(half.includes(`<text x="${geometry.full.years.anchors["5"]}"`), "Anker nach letzter Ziffer");
});
await t("Japanischer Shop: amtliche englische Fassung samt Texten", async () => {
  const html = await render({ locale: "ja", block: { address: "formal" } });
  assert.match(html, /eu-notice-en\.png/);
  assert.match(html, /Your legal guarantee rights/);
});

await t("Varianten: eigene Angaben überschreiben das Produkt, andere Varianten erben, false = kein Label", async () => {
  const html = await render({
    metafields: GARAN,
    variants: [
      { id: 11 },
      { id: 12, metafields: { garan_confirmed: true, garan_duration: 10, garan_brand: "Maik Hansen", garan_model: "MH-XL" } },
      { id: 13, metafields: { garan_confirmed: false } },
    ],
  });
  assert.match(html, /data-euw-variant="default">/, "Produkt-Label sichtbar für Variante 11 (erbt)");
  assert.match(html, /data-euw-variant="12" hidden>[\s\S]*?MH-XL/, "eigenes Label für Variante 12, verborgen");
  assert.match(html, /data-euw-variant="13" hidden><\/div>/, "Variante 13 ohne Label");
});
await t("Warenkorb: Mitteilung + GARAN je Artikel mit Titel, ausgeschlossene Artikel ohne Label", async () => {
  const item = (title: string, mfs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    product: { title, tags: [], "gift_card?": false, collections: [], has_only_default_variant: true, variants: [],
      metafields: { "$app:eu_warranty": Object.fromEntries(Object.entries(mfs).map(([k, v]) => [k, { value: v }])) }, ...extra },
    variant: { id: 1, title: "Default Title", requires_shipping: true, metafields: {} },
  });
  const cart = { item_count: 3, items: [item("Akkuschrauber", GARAN), item("Gutschein", GARAN, { "gift_card?": true }), item("Kabel", {})] };
  const html = await render({ template: "cart", cart }, "eu-warranty-cart");
  assert.match(html, /euw-notice--collapsed/);
  assert.match(html, /euw-cart-item__title">Akkuschrauber/);
  assert.doesNotMatch(html, /Gutschein<\/p>/, "Gutschein ausgeschlossen");
  assert.equal((html.match(/euw-cart-item"/g) ?? []).length, 1, "nur Artikel mit GARAN");
  assert.equal((await render({ template: "cart", cart: { item_count: 0, items: [] } }, "eu-warranty-cart")).trim(), "", "leerer Warenkorb");
});
await t("App-Embed: nur auf gewählten Seiten, fixiertes Band öffnet die Mitteilung", async () => {
  assert.match(await render({ template: "cart" }, "eu-warranty-embed"), /euw--embed/);
  assert.equal((await render({ template: "collection" }, "eu-warranty-embed")).trim(), "", "Kategorieseite nicht gewählt");
  assert.match(await render({ template: "collection", block: { on_collection: true } }, "eu-warranty-embed"), /euw--embed/);
  const sticky = await render({ template: "cart", block: { position: "sticky" } }, "eu-warranty-embed");
  assert.match(sticky, /euw--sticky/); assert.match(sticky, /data-euw-open="euw-blk-test-notice"/); assert.match(sticky, /euw-notice--hidden/);
  assert.equal((await render({ template: "cart", settings: { b2bOnly: true } }, "eu-warranty-embed")).trim(), "", "B2B");
});

console.log(ok.join("\n"));
console.log(ok.length + " Tests bestanden");
