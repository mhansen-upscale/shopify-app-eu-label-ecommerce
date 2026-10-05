import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { gql, getShopAndSettings, NS, type AdminApiContext, type MfValue } from "../lib/metafields.server";
import { formatDuration } from "../lib/garan";

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Abfragekosten je Produkt: 1 + 6 Metafields + variants(first: 1) mit inventoryItem (4) = 11.
// 80 × 11 + 2 = 882 bleibt unter dem Limit von 1000 Punkten pro Abfrage.
const PAGE_SIZE = 80;
const MAX_PAGES = 500; // Sicherung gegen Endlosschleifen (40.000 Produkte)

type ExportPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string; title: string; tags: string[]; isGiftCard: boolean;
      variants: { nodes: { inventoryItem: { requiresShipping: boolean } | null }[] };
      exclude: MfValue; used: MfValue; confirmed: MfValue; duration: MfValue; brand: MfValue; model: MfValue;
    }[];
  };
};

const EXPORT_QUERY = `#graphql
  query Export($after: String) {
    products(first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title tags isGiftCard
        variants(first: 1) { nodes { inventoryItem { requiresShipping } } }
        exclude: metafield(namespace: "${NS}", key: "exclude") { value }
        used: metafield(namespace: "${NS}", key: "used") { value }
        confirmed: metafield(namespace: "${NS}", key: "garan_confirmed") { value }
        duration: metafield(namespace: "${NS}", key: "garan_duration") { value }
        brand: metafield(namespace: "${NS}", key: "garan_brand") { value }
        model: metafield(namespace: "${NS}", key: "garan_model") { value }
      }
    }
  }`;

type CollectionPage = { collection: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string }[] } } | null };

/** Produkt-IDs der ausgeschlossenen Kollektionen (getrennt abgefragt: Kollektionen je Produkt würden das Kostenlimit sprengen). */
async function excludedByCollection(admin: AdminApiContext, collectionIds: string[]) {
  const ids = new Set<string>();
  for (const id of collectionIds) {
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data: CollectionPage = await gql<CollectionPage>(admin, `#graphql
        query C($id: ID!, $after: String) {
          collection(id: $id) { products(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }
        }`, { id, after });
      if (!data.collection) break;
      for (const p of data.collection.products.nodes) ids.add(p.id);
      if (!data.collection.products.pageInfo.hasNextPage) break;
      after = data.collection.products.pageInfo.endCursor;
    }
  }
  return ids;
}

/**
 * Nachweis-Export: aktueller Label-Stand je Produkt + Änderungsprotokoll.
 * Die Sichtbarkeit folgt denselben Regeln wie blocks/eu-warranty.liquid. Gestreamt, damit große Kataloge
 * (seitenweise, mit API-Drosselung) nicht in einen Proxy-Timeout laufen.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { settings, configured } = await getShopAndSettings(admin);
  const enc = new TextEncoder();
  const now = new Date().toISOString();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (rows: unknown[][]) => controller.enqueue(enc.encode(rows.map((r) => r.map(csv).join(";") + "\r\n").join("")));
      try {
        controller.enqueue(enc.encode("﻿"));
        write([["Abschnitt", "Produkt-ID", "Titel", "Label aktiv", "Ausgeschlossen", "Gebraucht", "GARAN bestätigt", "GARAN Jahre", "GARAN Marke", "GARAN Modell", "Zeitpunkt", "Details"]]);

        const inExcludedCollection = await excludedByCollection(admin, settings.excludeCollections.map((c) => c.id));
        let after: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const data: ExportPage = await gql<ExportPage>(admin, EXPORT_QUERY, { after });
          write(data.products.nodes.map((p) => {
            const tags = p.tags.map((t) => t.toLowerCase());
            const noShipping = p.variants.nodes[0]?.inventoryItem?.requiresShipping === false;
            const excluded = settings.b2bOnly || p.exclude?.value === "true" || (settings.excludeGiftCards && p.isGiftCard) ||
              (settings.excludeNoShipping && noShipping) || tags.some((t) => settings.excludeTags.includes(t)) ||
              inExcludedCollection.has(p.id);
            // Ohne gespeicherte Einstellungen rendert der Block nichts
            const active = configured && !excluded;
            const used = p.used?.value === "true" || (!!settings.usedTag && tags.includes(settings.usedTag));
            return ["Produkt", p.id, p.title, active ? "ja" : "nein", excluded ? "ja" : "nein", used ? "ja" : "nein",
              p.confirmed?.value === "true" ? "ja" : "nein", p.duration?.value ? formatDuration(Number(p.duration.value)) : "",
              p.brand?.value, p.model?.value, now, ""];
          }));
          if (!data.products.pageInfo.hasNextPage) break;
          after = data.products.pageInfo.endCursor;
        }

        const events = await prisma.complianceEvent.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "asc" } });
        write(events.map((e) => ["Protokoll", e.subject, e.type, "", "", "", "", "", "", "", e.createdAt.toISOString(), e.payload]));
        controller.close();
      } catch (err) {
        // Abbruch statt unvollständiger Datei: der Download im Dashboard schlägt dann sichtbar fehl
        console.error("Export fehlgeschlagen", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="eu-label-nachweis.csv"' },
  });
};
