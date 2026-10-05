import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureDefinitions, getShopAndSettings } from "../lib/metafields.server";
import { garanQuota, getPlan, pricingUrl } from "../lib/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDefinitions(admin, session.shop);
  const [{ settings, configured, domain }, plan] = await Promise.all([getShopAndSettings(admin), getPlan(admin)]);
  const [quota, lastEvent] = await Promise.all([
    garanQuota(session.shop, plan),
    prisma.complianceEvent.findFirst({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
  ]);
  // Direktlinks in den Theme-Editor (Handle = Dateiname des Blocks in extensions/eu-warranty-label/blocks)
  const editor = `https://${domain}/admin/themes/current/editor`;
  const key = process.env.SHOPIFY_API_KEY;
  const links = {
    product: `${editor}?template=product&addAppBlockId=${key}/eu-warranty&target=mainSection`,
    cart: `${editor}?template=cart&addAppBlockId=${key}/eu-warranty-cart&target=mainSection`,
    embed: `${editor}?context=apps&activateAppId=${key}/eu-warranty-embed`,
  };
  return {
    configured, links,
    b2bOnly: settings.b2bOnly,
    plan: { name: plan.label, unlimited: plan.unlimited },
    quota,
    pricing: pricingUrl(domain),
    lastEvent: lastEvent ? { type: lastEvent.type, at: lastEvent.createdAt.toISOString() } : null,
  };
};

export default function Index() {
  const d = useLoaderData<typeof loader>();
  const notice = d.b2bOnly ? "Ausgeschaltet (nur B2B-Verkauf)" : "Alle Produkte, abzüglich Ausschlüsse";
  const garan = `${d.quota.used} von ${d.quota.limit ?? "unbegrenzt"} Produkten mit GARAN-Label`;

  const [exporting, setExporting] = useState(false);

  // Der Export streamt seitenweise; bei großen Katalogen dauert er wegen der API-Drosselung eine Weile.
  async function downloadExport() {
    setExporting(true);
    try {
      const res = await fetch("/app/export");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eu-label-nachweis-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      shopify.toast.show("Export fehlgeschlagen. Bitte erneut versuchen.", { isError: true });
    } finally {
      setExporting(false);
    }
  }

  return (
    <s-page heading="EU-Gewährleistungslabel">
      {d.quota.over && (
        <s-banner tone="warning" heading="Mehr GARAN-Labels als im Tarif enthalten">
          <s-paragraph>
            Dein Tarif umfasst {d.quota.limit} Produkte mit GARAN-Label, hinterlegt sind {d.quota.used}. Die bestehenden Labels
            bleiben im Shop sichtbar. Neue Labels und Änderungen sind erst nach einem Tarifwechsel möglich oder wenn du bei
            anderen Produkten die GARAN-Angaben entfernst.
          </s-paragraph>
          <s-button slot="secondary-actions" href={d.pricing} target="_top">Tarif ändern</s-button>
        </s-banner>
      )}

      {!d.configured && (
        <s-banner tone="warning" heading="Noch nicht eingerichtet">
          <s-paragraph>Speichere einmal die Einstellungen, damit das Label im Shop erscheint.</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Einrichtung">
        <s-stack gap="base">
          <s-paragraph>1. Füge den Block „EU-Gewährleistungslabel“ in dein Produkt-Template ein (Mitteilung und GARAN-Label).</s-paragraph>
          <s-button href={d.links.product} target="_top" variant="primary">Block auf der Produktseite einfügen</s-button>
          <s-paragraph>2. Zeige Mitteilung und GARAN-Labels auch im Warenkorb, direkt vor der Bestellung.</s-paragraph>
          <s-button href={d.links.cart} target="_top">Block im Warenkorb einfügen</s-button>
          <s-paragraph>
            3. Optional: Aktiviere die App-Einbettung, um die Mitteilung zusätzlich shopweit zu zeigen, etwa auf Kategorieseiten
            oder als Band am unteren Rand. Sie funktioniert auch in Themes ohne Blöcke im Warenkorb.
          </s-paragraph>
          <s-button href={d.links.embed} target="_top">App-Einbettung aktivieren</s-button>
          <s-paragraph>4. Lege fest, was von der Mitteilung ausgenommen ist (z. B. Gutscheine, Dienstleistungen, B2B).</s-paragraph>
          <s-button href="/app/settings">Einstellungen öffnen</s-button>
          <s-paragraph>5. Trage bei Produkten mit Herstellergarantie über 2 Jahre Marke, Modell und Dauer ein.</s-paragraph>
          <s-button href="/app/products">Produkte bearbeiten</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Status">
        <s-stack gap="small-200">
          <s-text>Tarif: {d.plan.name}</s-text>
          <s-text>Gewährleistungsmitteilung: {notice}</s-text>
          <s-text>GARAN: {garan}</s-text>
          <s-text>
            Letzte Änderung: {d.lastEvent ? new Date(d.lastEvent.at).toLocaleString("de-DE") : "noch keine"}
          </s-text>
          <s-stack direction="inline" gap="base">
            <s-button onClick={downloadExport} loading={exporting}>Nachweis als CSV exportieren</s-button>
            {!d.plan.unlimited && <s-button href={d.pricing} target="_top">Tarif ändern</s-button>}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
