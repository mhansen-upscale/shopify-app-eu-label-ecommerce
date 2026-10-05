/** Minimaler Typ für den Admin-GraphQL-Client aus authenticate.admin(). */
export type AdminApiContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};
import prisma from "../db.server";

// App-eigener Namespace: Händler sehen die Werte im Shopify-Admin, ändern können sie nur über die App (Prüfungen,
// Bestätigung, Tariflimit). Im Theme: product.metafields["$app:eu_warranty"], shop.metafields["$app:eu_warranty"].
export const NS = "$app:eu_warranty";
const LEGACY_NS = "eu_warranty";
// 3: Namespace $app:eu_warranty (vorher eu_warranty, editierbar für Händler); "active" entfällt (Mitteilung shopweit)
// 4: GARAN-Angaben je Variante
// 5: veröffentlichte Bilder für Checkout und Bestellbestätigung (app/lib/publish.server.ts)
const DEFINITIONS_VERSION = 5;

type Def = {
  ownerType: "PRODUCT" | "PRODUCTVARIANT" | "SHOP";
  key: string;
  type: string;
  name: string;
  description?: string;
  validations?: { name: string; value: string }[];
};

const DEFINITIONS: Def[] = [
  { ownerType: "SHOP", key: "settings", type: "json", name: "EU-Label: Einstellungen" },
  { ownerType: "PRODUCT", key: "exclude", type: "boolean", name: "Vom EU-Label ausschließen",
    description: "Z. B. für digitale Waren, Dienstleistungen oder reine B2B-Produkte." },
  { ownerType: "PRODUCT", key: "used", type: "boolean", name: "Gebrauchtware" },
  { ownerType: "PRODUCT", key: "garan_confirmed", type: "boolean", name: "GARAN: qualifizierte Herstellergarantie bestätigt",
    description: "Garantie des Herstellers für die gesamte Ware, ohne Zusatzkosten, länger als 2 Jahre. Ohne Bestätigung kein Label." },
  { ownerType: "PRODUCT", key: "garan_duration", type: "number_decimal", name: "GARAN: Garantiedauer (Jahre)",
    description: "Ganze oder halbe Jahre, mehr als 2 (z. B. 3 oder 4,5).",
    validations: [{ name: "min", value: "2.5" }, { name: "max", value: "99" }] },
  { ownerType: "PRODUCT", key: "garan_brand", type: "single_line_text_field", name: "GARAN: Marke/Hersteller" },
  { ownerType: "PRODUCT", key: "garan_model", type: "single_line_text_field", name: "GARAN: Modellkennung" },
  // Varianten: gesetztes garan_confirmed = eigene Angaben ("false" = für diese Variante kein Label), sonst wie das Produkt
  { ownerType: "PRODUCTVARIANT", key: "garan_confirmed", type: "boolean", name: "GARAN: eigene Herstellergarantie dieser Variante" },
  { ownerType: "PRODUCTVARIANT", key: "garan_duration", type: "number_decimal", name: "GARAN: Garantiedauer (Jahre)",
    validations: [{ name: "min", value: "2.5" }, { name: "max", value: "99" }] },
  { ownerType: "PRODUCTVARIANT", key: "garan_brand", type: "single_line_text_field", name: "GARAN: Marke/Hersteller" },
  { ownerType: "PRODUCTVARIANT", key: "garan_model", type: "single_line_text_field", name: "GARAN: Modellkennung" },
  // Von der App abgeleitet, gelesen von Checkout-Extension und Bestellbestätigung (Format: app/lib/publish.server.ts)
  { ownerType: "SHOP", key: "notice", type: "multi_line_text_field", name: "EU-Label: Mitteilung für Checkout und E-Mail",
    description: "Wird von der App gepflegt (Bilder in Shopify Files, Texte je Sprache)." },
  { ownerType: "PRODUCT", key: "garan_image", type: "single_line_text_field", name: "GARAN: Bild für Checkout und E-Mail",
    description: "Wird von der App aus den GARAN-Angaben erzeugt." },
  { ownerType: "PRODUCTVARIANT", key: "garan_image", type: "single_line_text_field", name: "GARAN: Bild für Checkout und E-Mail",
    description: "Wird von der App erzeugt; \"none\" = diese Variante ohne Label." },
];

export type Settings = {
  b2bOnly: boolean; // nur Verkauf an Unternehmen: Pflicht gilt nicht, Mitteilung und GARAN shopweit aus
  excludeGiftCards: boolean;
  excludeNoShipping: boolean;
  excludeTags: string[];
  excludeCollections: { id: string; title: string }[];
  excludeCollectionIds: string[]; // numerische IDs für Liquid (collection.id)
  usedTag: string;
  usedHint: string;
};

export const DEFAULT_SETTINGS: Settings = {
  b2bOnly: false,
  excludeGiftCards: true,
  excludeNoShipping: true,
  excludeTags: ["b2b", "dienstleistung", "service"],
  excludeCollections: [],
  excludeCollectionIds: [],
  usedTag: "gebraucht",
  usedHint: "",
};

/** Metafield-Wert, wie ihn Abfragen mit Alias (`active: metafield(...) { value }`) liefern. */
export type MfValue = { value: string } | null;
type UserError = { code?: string; field?: string[]; message: string };
type GqlErrorBody = {
  errors?: { graphQLErrors?: { extensions?: { code?: string } }[] };
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wartezeit in ms, wenn Shopify wegen Abfragekosten drosselt (THROTTLED kommt als GraphQL-Fehler, nicht als HTTP 429). */
function throttleDelay(err: unknown): number | null {
  const body = (err as { body?: GqlErrorBody } | null)?.body;
  if (!body?.errors?.graphQLErrors?.some((e) => e.extensions?.code === "THROTTLED")) return null;
  const cost = body.extensions?.cost;
  const missing = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
  const rate = cost?.throttleStatus?.restoreRate || 50;
  return Math.max(1000, Math.ceil((missing / rate) * 1000) + 250);
}

async function gql<T>(admin: AdminApiContext, query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await admin.graphql(query, { variables });
      const json = (await res.json()) as { data: T; errors?: unknown };
      if (json.errors) throw new Error(JSON.stringify(json.errors));
      return json.data;
    } catch (err) {
      const wait = throttleDelay(err);
      if (wait === null || attempt >= 5) throw err;
      await sleep(wait);
    }
  }
}

/** Legt Metafield-Definitionen einmalig pro Shop an (idempotent, "TAKEN" wird ignoriert). */
export async function ensureDefinitions(admin: AdminApiContext, shop: string) {
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (cfg && cfg.definitionsVersion >= DEFINITIONS_VERSION) return;

  for (const d of DEFINITIONS) {
    const data = await gql<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(admin, `#graphql
      mutation Def($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          userErrors { code message }
        }
      }`, {
      definition: {
        namespace: NS, key: d.key, type: d.type, name: d.name, description: d.description,
        ownerType: d.ownerType, validations: d.validations ?? [],
        access: { admin: "MERCHANT_READ", storefront: "PUBLIC_READ" },
      },
    });
    const errs = data.metafieldDefinitionCreate.userErrors.filter((e) => e.code !== "TAKEN");
    if (errs.length) throw new Error(`Metafield ${d.key}: ${errs.map((e) => e.message).join(", ")}`);
  }

  // Alte, für Händler editierbare Definitionen (vor Version 3) samt Werten entfernen
  if (cfg && cfg.definitionsVersion > 0 && cfg.definitionsVersion < 3) {
    for (const ownerType of ["PRODUCT", "SHOP"]) {
      const old = await gql<{ metafieldDefinitions: { nodes: { id: string }[] } }>(admin, `#graphql
        query Old($ownerType: MetafieldOwnerType!) {
          metafieldDefinitions(first: 50, ownerType: $ownerType, namespace: "${LEGACY_NS}") { nodes { id } }
        }`, { ownerType });
      for (const { id } of old.metafieldDefinitions.nodes) {
        await gql(admin, `#graphql
          mutation Del($id: ID!) {
            metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: true) { userErrors { message } }
          }`, { id });
      }
    }
  }

  await prisma.shopConfig.upsert({
    where: { shop },
    create: { shop, definitionsVersion: DEFINITIONS_VERSION },
    update: { definitionsVersion: DEFINITIONS_VERSION },
  });
}

export async function getShopAndSettings(admin: AdminApiContext) {
  const data = await gql<{ shop: { id: string; name: string; myshopifyDomain: string; metafield: MfValue } }>(admin, `#graphql
    query { shop { id name myshopifyDomain metafield(namespace: "${NS}", key: "settings") { value } } }`);
  let settings = DEFAULT_SETTINGS;
  if (data.shop.metafield?.value) {
    try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data.shop.metafield.value) }; } catch { /* Defaults */ }
  }
  return { shopId: data.shop.id, shopName: data.shop.name, domain: data.shop.myshopifyDomain, settings, configured: !!data.shop.metafield };
}

export async function saveSettings(admin: AdminApiContext, shopId: string, settings: Settings) {
  await setMetafields(admin, [{ ownerId: shopId, key: "settings", type: "json", value: JSON.stringify(settings) }]);
}

export type MfInput = { ownerId: string; key: string; type: string; value: string };

export async function setMetafields(admin: AdminApiContext, inputs: MfInput[]) {
  if (!inputs.length) return;
  for (let i = 0; i < inputs.length; i += 25) {
    const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(admin, `#graphql
      mutation Set($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`, { metafields: inputs.slice(i, i + 25).map((m) => ({ ...m, namespace: NS })) });
    const errs = data.metafieldsSet.userErrors;
    if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));
  }
}

/** Löscht Metafields im Namespace, auch über mehrere Produkte (Eingabe-Arrays max. 250 Einträge). */
export async function deleteMetafields(admin: AdminApiContext, ids: { ownerId: string; key: string }[]) {
  for (let i = 0; i < ids.length; i += 250) {
    const data = await gql<{ metafieldsDelete: { userErrors: UserError[] } }>(admin, `#graphql
      mutation Del($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { field message } }
      }`, { metafields: ids.slice(i, i + 250).map((m) => ({ ...m, namespace: NS })) });
    const errs = data.metafieldsDelete.userErrors;
    if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));
  }
}

export { gql };
