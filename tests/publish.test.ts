// Veröffentlichen für Checkout und Bestellbestätigung (app/lib/publish.server.ts) gegen einen simulierten Admin-Client
// und die lokale Postgres aus docker-compose (Tabelle RenderedFile). Uploads gehen an einen simulierten Speicher.
import assert from "node:assert/strict";
import prisma from "../app/db.server";
import { DEFAULT_SETTINGS } from "../app/lib/metafields.server";
import { publishAll, publishGaran, publishNotice } from "../app/lib/publish.server";
import { setGaranProduct } from "../app/lib/plan.server";

const SHOP = "claude-publishtest.myshopify.com";
const SHOP_ID = "gid://shopify/Shop/7";
const results: string[] = [];
const t = async (name: string, fn: () => Promise<void>) => { await fn(); results.push("✓ " + name); };

// --- Simulierter Shopify-Admin: Files, Metafields, ein Produkt mit Varianten ----------------------------------------
type Mf = { value: string } | null;
const state = {
  shopMf: {} as Record<string, string>,
  ownerMf: {} as Record<string, Record<string, string>>,
  files: new Map<string, string>(), // id -> url
  uploads: 0,
  sets: 0,
  product: null as null | { id: string; mf: Record<string, string>; variants: { id: string; mf: Record<string, string> }[] },
};
const val = (o: Record<string, string> | undefined, k: string): Mf => (o && k in o ? { value: o[k] } : null);
const garanMf = (o: Record<string, string>) => ({
  confirmed: val(o, "garan_confirmed"), duration: val(o, "garan_duration"), brand: val(o, "garan_brand"),
  model: val(o, "garan_model"), image: val(state.ownerMf[o.__id], "garan_image"),
});
let nextFile = 1;
const admin = {
  graphql: async (query: string, opts?: { variables?: any }) => {
    const v = opts?.variables ?? {};
    let data: unknown;
    if (/stagedUploadsCreate/.test(query)) {
      data = { stagedUploadsCreate: { userErrors: [], stagedTargets: v.input.map((i: any) => ({
        url: "https://upload.test/bucket", resourceUrl: `https://upload.test/r/${i.filename}`, parameters: [{ name: "key", value: i.filename }],
      })) } };
    } else if (/fileCreate/.test(query)) {
      const files = v.files.map((f: any) => {
        const id = `gid://shopify/MediaImage/${nextFile++}`;
        state.files.set(id, `https://cdn.shopify.com/s/files/1/7/files/${f.filename}?v=${id.split("/").pop()}`);
        return { id };
      });
      data = { fileCreate: { files, userErrors: [] } };
    } else if (/FileStatus/.test(query)) {
      data = { nodes: v.ids.map((id: string) => (state.files.has(id) ? { id, fileStatus: "READY", image: { url: state.files.get(id) }, fileErrors: [] } : null)) };
    } else if (/metafieldsSet/.test(query)) {
      state.sets += v.metafields.length;
      for (const m of v.metafields) {
        if (m.ownerId === SHOP_ID) state.shopMf[m.key] = m.value;
        else (state.ownerMf[m.ownerId] ??= {})[m.key] = m.value;
      }
      data = { metafieldsSet: { userErrors: [] } };
    } else if (/metafieldsDelete/.test(query)) {
      for (const m of v.metafields) {
        if (m.ownerId === SHOP_ID) delete state.shopMf[m.key];
        else delete state.ownerMf[m.ownerId]?.[m.key];
      }
      data = { metafieldsDelete: { userErrors: [] } };
    } else if (/notice: metafield/.test(query)) {
      data = { shop: { notice: val(state.shopMf, "notice") } };
    } else if (/PublishGaran/.test(query)) {
      const p = state.product;
      data = { product: p && p.id === v.id ? {
        exclude: val(p.mf, "exclude"), ...garanMf({ ...p.mf, __id: p.id }),
        variants: { nodes: p.variants.map((x) => ({ id: x.id, ...garanMf({ ...x.mf, __id: x.id }) })) },
      } : null };
    } else throw new Error("Unerwartete Abfrage: " + query.slice(0, 80));
    return new Response(JSON.stringify({ data }));
  },
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).startsWith("https://upload.test/")) {
    assert.ok(init?.body instanceof FormData && (init.body.get("file") as Blob).size > 1000, "Datei im Upload");
    state.uploads++;
    return new Response(null, { status: 201 });
  }
  return realFetch(url, init);
}) as typeof fetch;

const P = "gid://shopify/Product/500";
const V = (n: number) => `gid://shopify/ProductVariant/50${n}`;
const garan = (duration: string, brand: string, model: string) =>
  ({ garan_confirmed: "true", garan_duration: duration, garan_brand: brand, garan_model: model });

async function reset() {
  await prisma.renderedFile.deleteMany({ where: { shop: SHOP } });
  await prisma.garanProduct.deleteMany({ where: { shop: SHOP } });
  Object.assign(state, { shopMf: {}, ownerMf: {}, files: new Map(), uploads: 0, sets: 0, product: null });
}

try {
  await reset();

  await t("Mitteilung: 24 Bilder einmal hochgeladen, danach aus dem Zwischenspeicher, unveränderter Wert nicht neu gesetzt", async () => {
    const r = await publishNotice(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS);
    assert.equal(r.languages, 24);
    assert.equal(state.uploads, 24);
    const records = state.shopMf.notice.split("§");
    assert.equal(records.length, 24);
    assert.match(records[0], /^en\|https:\/\/cdn\.shopify\.com\/.+eu-gewaehrleistung-mitteilung-en\.png/);
    const sets = state.sets;
    await publishNotice(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS);
    assert.equal(state.uploads, 24, "keine erneuten Uploads");
    assert.equal(state.sets, sets, "Wert unverändert -> kein metafieldsSet");
  });

  await t("Nur B2B entfernt die Mitteilung; Einstellungen speichern ohne Upload stellt sie wieder her", async () => {
    await publishNotice(admin, SHOP, SHOP_ID, { ...DEFAULT_SETTINGS, b2bOnly: true }, false);
    assert.equal(state.shopMf.notice, undefined);
    await publishNotice(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS, false);
    assert.equal((state.shopMf.notice as string).split("§").length, 24); // assert.equal hat oben auf undefined eingeengt
    assert.equal(state.uploads, 24);
  });

  await t("Ohne bereitgestellte Bilder lädt das Speichern der Einstellungen nichts hoch", async () => {
    await prisma.renderedFile.deleteMany({ where: { shop: SHOP } });
    delete state.shopMf.notice;
    const r = await publishNotice(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS, false);
    assert.equal(r.languages, 0);
    assert.equal(state.shopMf.notice, undefined);
    assert.equal(state.uploads, 24);
  });

  await t("GARAN: Produkt, eigene Variante, Variante ohne Label, erbende Variante mit altem Bild", async () => {
    await reset();
    state.product = {
      id: P, mf: garan("5.0", "Miele", "WWD 320"),
      variants: [
        { id: V(1), mf: {} },                                   // erbt
        { id: V(2), mf: garan("10.0", "Miele", "WWD 320 XL") }, // eigene Angaben
        { id: V(3), mf: { garan_confirmed: "false" } },          // kein Label
        { id: V(4), mf: garan("10.0", "Miele", "WWD 320 XL") }, // gleiche Angaben wie V2 -> gleiche Datei
      ],
    };
    state.ownerMf[V(1)] = { garan_image: "https://cdn.shopify.com/alt.png" };
    const r = await publishGaran(admin, SHOP, P);
    assert.equal(r.images, 3);
    assert.equal(state.uploads, 2, "zwei verschiedene Labels");
    assert.match(state.ownerMf[P].garan_image, /garan-miele-wwd-320\.png/);
    assert.equal(state.ownerMf[V(1)]?.garan_image, undefined, "erbende Variante: altes Bild entfernt");
    assert.match(state.ownerMf[V(2)].garan_image, /garan-miele-wwd-320-xl\.png/);
    assert.equal(state.ownerMf[V(3)].garan_image, "none");
    assert.equal(state.ownerMf[V(4)].garan_image, state.ownerMf[V(2)].garan_image);
    const sets = state.sets;
    await publishGaran(admin, SHOP, P);
    assert.equal(state.sets, sets, "unverändert -> nichts geschrieben");
    assert.equal(state.uploads, 2);
  });

  await t("GARAN: ungültige Angaben und ausgeschlossenes Produkt -> keine Bilder", async () => {
    state.product!.mf = { ...garan("2.0", "Miele", "WWD 320") }; // 2 Jahre: kein GARAN
    await publishGaran(admin, SHOP, P);
    assert.equal(state.ownerMf[P].garan_image, undefined);
    state.product!.mf = { ...garan("5.0", "Miele", "WWD 320"), exclude: "true" };
    await publishGaran(admin, SHOP, P);
    for (const id of [P, V(1), V(2), V(3), V(4)]) assert.equal(state.ownerMf[id]?.garan_image, undefined, id);
    assert.equal(state.uploads, 2);
  });

  await t("Alles bereitstellen: gelöschte Dateien neu, Produkte aus der GARAN-Zählung", async () => {
    await reset();
    state.product = { id: P, mf: garan("4.0", "Bosch", "WAX32M40"), variants: [] };
    await setGaranProduct(SHOP, P, true);
    await setGaranProduct(SHOP, "gid://shopify/Product/999", true); // inzwischen gelöscht
    const first = await publishAll(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS);
    assert.deepEqual({ languages: first.languages, products: first.products, failed: first.failed.length }, { languages: 24, products: 2, failed: 0 });
    assert.equal(state.uploads, 25);
    state.files.delete([...state.files.keys()][0]); // Händler löscht eine Datei in Shopify Files
    const second = await publishAll(admin, SHOP, SHOP_ID, DEFAULT_SETTINGS);
    assert.equal(second.forgotten, 1);
    assert.equal(state.uploads, 26);
  });
} finally {
  await reset();
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
}

console.log(results.join("\n"));
console.log(`\n${results.length} Prüfungen bestanden`);
