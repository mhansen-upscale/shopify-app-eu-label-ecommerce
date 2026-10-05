import { createHash } from "node:crypto";
import prisma from "../db.server";
import { gql, setMetafields, deleteMetafields, NS, type AdminApiContext, type MfInput, type MfValue, type Settings } from "./metafields.server";
import { renderGaranPng, noticePng, RENDER_VERSION, type GaranLabel } from "./render.server";
import { uploadImages, fileStatus, type ImageUpload } from "./files.server";
import { formatDuration, validateGaran } from "./garan";
import storefrontTexts from "./storefront-texts.json";

// Checkout-Extension und Bestellbestätigung können weder Liquid-Snippets noch Theme-Assets nutzen. Die App
// veröffentlicht deshalb fertige Werte in Metafields, die beide nur noch anzeigen (keine eigene Regel-Logik):
//   Shop     notice       Mitteilung je Sprache als Datensätze (siehe NOTICE_FIELDS); fehlt bei "nur B2B"
//   Produkt  garan_image  CDN-URL des vollen GARAN-Labels; fehlt ohne gültiges GARAN oder bei ausgeschlossenem Produkt
//   Variante garan_image  eigene Angaben: URL, oder "none" (Variante ohne Label); fehlt = wie das Produkt
// Ausschlüsse über Tags/Kollektionen, Geschenkkarten und Versand wertet nur das Theme aus (snippets/euw-rules).

type Texts = Record<string, Record<string, string>>;
const TEXTS = storefrontTexts as Texts;
// Englisch zuerst: Rückfall, wenn die Bestellsprache keine amtliche Fassung hat
export const NOTICE_LANGS = ["en", ...Object.keys(TEXTS).filter((l) => l !== "en")];

/**
 * Felder eines Datensatzes im Shop-Metafield "notice" (Datensätze durch '§', Felder durch '|' getrennt).
 * Gelesen von extensions/eu-warranty-checkout/src/shared.js und dem Mail-Baustein (app/lib/email-snippet.ts).
 */
export const NOTICE_FIELDS = ["lang", "image", "notice_url", "notice_url_label", "title", "sentence_neutral",
  "sentence_formal", "sentence_informal", "garan_term", "garan_years", "garan_url", "garan_url_label", "enlarge", "dims"] as const;

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex").slice(0, 32);
const slug = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "x";

type Wanted = { key: string; make: () => Promise<ImageUpload> };

/** URLs zu den gewünschten Bildern; fehlende werden erzeugt und hochgeladen (uploadMissing = false: nur vorhandene). */
async function files(admin: AdminApiContext, shop: string, wanted: Wanted[], uploadMissing = true) {
  const keys = [...new Set(wanted.map((w) => w.key))];
  const rows = keys.length ? await prisma.renderedFile.findMany({ where: { shop, key: { in: keys } } }) : [];
  const urls = new Map(rows.map((r) => [r.key, r.url]));
  const missing = keys.filter((k) => !urls.has(k)).map((k) => wanted.find((w) => w.key === k)!);
  if (missing.length && uploadMissing) {
    const uploaded = await uploadImages(admin, await Promise.all(missing.map((w) => w.make())));
    await prisma.renderedFile.createMany({
      data: uploaded.map((f, k) => ({ shop, key: missing[k].key, fileId: f.fileId, url: f.url })), skipDuplicates: true,
    });
    uploaded.forEach((f, k) => urls.set(missing[k].key, f.url));
  }
  return urls;
}

/** Vom Händler in Shopify Files gelöschte Bilder vergessen, damit sie beim nächsten Veröffentlichen neu entstehen. */
async function forgetDeletedFiles(admin: AdminApiContext, shop: string) {
  const rows = await prisma.renderedFile.findMany({ where: { shop } });
  if (!rows.length) return 0;
  const alive = new Set((await fileStatus(admin, rows.map((r) => r.fileId))).filter((f) => f.status !== "FAILED").map((f) => f.id));
  const gone = rows.filter((r) => !alive.has(r.fileId));
  if (gone.length) await prisma.renderedFile.deleteMany({ where: { shop, key: { in: gone.map((r) => r.key) } } });
  return gone.length;
}

// --- Mitteilung (Anhang I) -------------------------------------------------------------------------------------

/**
 * Shop-Metafield "notice" setzen: alle 24 Sprachfassungen mit Bild-URL und Texten. Bei "nur B2B" entfernt, damit
 * Checkout und Bestellbestätigung nichts zeigen. uploadMissing = false (z. B. beim Speichern der Einstellungen):
 * nur aus bereits hochgeladenen Bildern, sonst unverändert lassen.
 */
export async function publishNotice(admin: AdminApiContext, shop: string, shopId: string, settings: Settings, uploadMissing = true) {
  const current = await gql<{ shop: { notice: MfValue } }>(admin, `#graphql
    query { shop { notice: metafield(namespace: "${NS}", key: "notice") { value } } }`);
  if (settings.b2bOnly) {
    if (current.shop.notice) await deleteMetafields(admin, [{ ownerId: shopId, key: "notice" }]);
    return { languages: 0 };
  }
  const pngs = await Promise.all(NOTICE_LANGS.map((lang) => noticePng(lang)));
  const wanted = NOTICE_LANGS.map((lang, i) => ({
    lang,
    key: `notice:${lang}:${sha(pngs[i])}`,
    make: async () => ({ filename: `eu-gewaehrleistung-mitteilung-${lang}.png`, alt: TEXTS[lang].title, data: pngs[i] }),
  }));
  const urls = await files(admin, shop, wanted, uploadMissing);
  if (wanted.some((w) => !urls.has(w.key))) return { languages: current.shop.notice ? countNotice(current.shop.notice.value) : 0 };

  const value = noticeValue(new Map(wanted.map(({ lang, key }) => [lang, urls.get(key)!])));
  if (current.shop.notice?.value !== value) {
    await setMetafields(admin, [{ ownerId: shopId, key: "notice", type: "multi_line_text_field", value }]);
  }
  return { languages: wanted.length };
}

/** Wert des Shop-Metafields "notice" aus den Bild-URLs je Sprache (Englisch zuerst). */
export function noticeValue(images: Map<string, string>) {
  return NOTICE_LANGS.map((lang) => NOTICE_FIELDS.map((f) => {
    const t = TEXTS[lang];
    const v = f === "lang" ? lang : f === "image" ? images.get(lang) : f === "notice_url" || f === "garan_url" ? encodeURI(t[f]) : t[f];
    if (!v || /[|§]/.test(v)) throw new Error(`notice ${lang}.${f}: leer oder Trennzeichen im Wert`);
    return v;
  }).join("|")).join("§");
}

export const countNotice = (value: string | undefined | null) => (value ? value.split("§").filter((r) => r.split("|")[1]).length : 0);

// --- GARAN je Produkt/Variante -----------------------------------------------------------------------------------

type GaranMf = { confirmed: MfValue; duration: MfValue; brand: MfValue; model: MfValue; image: MfValue };
const garanFields = `
  confirmed: metafield(namespace: "${NS}", key: "garan_confirmed") { value }
  duration: metafield(namespace: "${NS}", key: "garan_duration") { value }
  brand: metafield(namespace: "${NS}", key: "garan_brand") { value }
  model: metafield(namespace: "${NS}", key: "garan_model") { value }
  image: metafield(namespace: "${NS}", key: "garan_image") { value }`;

/** Gültiges Label wie in snippets/garan-label.liquid (bestätigt, > 2 Jahre, Marke, Modell) und passend gesetzt. */
export function garanLabel(m: Pick<GaranMf, "confirmed" | "duration" | "brand" | "model">): GaranLabel | null {
  if (m.confirmed?.value !== "true" || !m.duration?.value) return null;
  const input = { duration: formatDuration(Number(m.duration.value)), brand: m.brand?.value?.trim() ?? "", model: m.model?.value?.trim() ?? "" };
  const { errors, years } = validateGaran(input);
  if (years === null || Object.keys(errors).length) return null;
  return { years: formatDuration(years), brand: input.brand, model: input.model };
}

const garanWanted = (label: GaranLabel): Wanted => ({
  key: `garan:${RENDER_VERSION}:${sha(JSON.stringify([label.years, label.brand, label.model]))}`,
  make: async () => ({
    filename: `garan-${slug(label.brand)}-${slug(label.model)}.png`,
    alt: `GARAN ${label.years} – ${label.brand}, ${label.model}`,
    data: await renderGaranPng(label),
  }),
});

const MAX_VARIANTS = 100; // wie app.products.$id

/** garan_image an Produkt und Varianten aus den gespeicherten GARAN-Angaben ableiten (rendert/lädt nur Neues hoch). */
export async function publishGaran(admin: AdminApiContext, shop: string, productId: string) {
  const data = await gql<{ product: (GaranMf & { exclude: MfValue; variants: { nodes: ({ id: string } & GaranMf)[] } }) | null }>(admin, `#graphql
    query PublishGaran($id: ID!) {
      product(id: $id) {
        exclude: metafield(namespace: "${NS}", key: "exclude") { value }
        ${garanFields}
        variants(first: ${MAX_VARIANTS}) { nodes { id ${garanFields} } }
      }
    }`, { id: productId });
  const p = data.product;
  if (!p) return { images: 0 };
  const excluded = p.exclude?.value === "true";

  // Soll-Zustand: Label, "none" (Variante ohne Label) oder null (kein Metafield)
  type Want = { ownerId: string; current: string | null; label: GaranLabel | null; none?: boolean };
  const wants: Want[] = [{ ownerId: productId, current: p.image?.value ?? null, label: excluded ? null : garanLabel(p) }];
  for (const v of p.variants.nodes) {
    const own = v.confirmed?.value !== undefined;
    const label = own && !excluded ? garanLabel(v) : null;
    wants.push({ ownerId: v.id, current: v.image?.value ?? null, label, none: own && !label && !excluded });
  }

  const wanted = wants.flatMap((w) => (w.label ? [garanWanted(w.label)] : []));
  const urls = await files(admin, shop, wanted);
  const set: MfInput[] = [];
  const del: { ownerId: string; key: string }[] = [];
  for (const w of wants) {
    const value = w.label ? urls.get(garanWanted(w.label).key)! : w.none ? "none" : null;
    if (value === w.current) continue;
    if (value) set.push({ ownerId: w.ownerId, key: "garan_image", type: "single_line_text_field", value });
    else del.push({ ownerId: w.ownerId, key: "garan_image" });
  }
  await setMetafields(admin, set);
  await deleteMetafields(admin, del);
  return { images: wanted.length };
}

/** Alles neu veröffentlichen (Seite "Checkout & E-Mail"): Mitteilung + alle Produkte mit GARAN. */
export async function publishAll(admin: AdminApiContext, shop: string, shopId: string, settings: Settings) {
  const forgotten = await forgetDeletedFiles(admin, shop);
  const notice = await publishNotice(admin, shop, shopId, settings);
  const products = await prisma.garanProduct.findMany({ where: { shop }, select: { productId: true } });
  const failed: { productId: string; error: string }[] = [];
  let images = 0;
  for (const { productId } of products) {
    try {
      images += (await publishGaran(admin, shop, productId)).images;
    } catch (err) {
      failed.push({ productId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { languages: notice.languages, products: products.length, images, failed, forgotten };
}
