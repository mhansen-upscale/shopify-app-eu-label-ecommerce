import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureDefinitions, getShopAndSettings, gql, NS, type MfValue } from "../lib/metafields.server";
import { countNotice, NOTICE_LANGS, publishAll } from "../lib/publish.server";
import { emailSnippet, type Address } from "../lib/email-snippet";
import { logEvent } from "../lib/audit.server";

// Danke-/Bestellstatusseite (Checkout-Extension eu-warranty-checkout) und Bestellbestätigung: beide zeigen nur, was die
// App in Metafields veröffentlicht (app/lib/publish.server.ts). Hier stellt der Händler die Bilder bereit und kopiert den
// Mail-Baustein; die Bestätigung "eingefügt" landet mit Datum im Nachweis-Protokoll.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDefinitions(admin, session.shop);
  const [{ settings, domain }, data, cfg, garanProducts, lastPublish] = await Promise.all([
    getShopAndSettings(admin),
    gql<{ currentAppInstallation: { app: { id: string } }; shop: { notice: MfValue } }>(admin, `#graphql
      query { currentAppInstallation { app { id } } shop { notice: metafield(namespace: "${NS}", key: "notice") { value } } }`),
    prisma.shopConfig.findUnique({ where: { shop: session.shop } }),
    prisma.garanProduct.count({ where: { shop: session.shop } }),
    prisma.complianceEvent.findFirst({ where: { shop: session.shop, type: "publish.all" }, orderBy: { createdAt: "desc" } }),
  ]);
  const editor = `https://${domain}/admin/settings/checkout/editor`;
  return {
    appId: data.currentAppInstallation.app.id.split("/").pop()!,
    b2bOnly: settings.b2bOnly,
    languages: countNotice(data.shop.notice?.value),
    totalLanguages: NOTICE_LANGS.length,
    garanProducts,
    lastPublish: lastPublish?.createdAt.toISOString() ?? null,
    emailSnippetAt: cfg?.emailSnippetAt?.toISOString() ?? null,
    links: { thankYou: `${editor}?page=thank-you`, orderStatus: `${editor}?page=order-status`, notifications: `https://${domain}/admin/settings/notifications` },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = String(f.get("intent"));

  if (intent === "publish") {
    const { shopId, settings } = await getShopAndSettings(admin);
    try {
      const result = await publishAll(admin, session.shop, shopId, settings);
      await logEvent(session.shop, "publish.all", null, result);
      return { published: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logEvent(session.shop, "publish.failed", null, { message });
      return { publishError: message };
    }
  }

  if (intent === "email-confirm" || intent === "email-unconfirm") {
    const at = intent === "email-confirm" ? new Date() : null;
    await prisma.shopConfig.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, emailSnippetAt: at },
      update: { emailSnippetAt: at },
    });
    await logEvent(session.shop, at ? "email.snippet_confirmed" : "email.snippet_unconfirmed", null, { at });
    return { ok: true };
  }
  throw new Response("Unbekannte Aktion", { status: 400 });
};

const dateTime = (iso: string) => new Date(iso).toLocaleString("de-DE");

export default function CheckoutEmail() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = (intent: string) => nav.state === "submitting" && nav.formData?.get("intent") === intent;
  const [address, setAddress] = useState<Address>("neutral");
  const snippet = emailSnippet(d.appId, address);
  const ready = d.languages === d.totalLanguages;
  const published = result && "published" in result ? result.published : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      shopify.toast.show("Baustein kopiert");
    } catch {
      shopify.toast.show("Kopieren nicht möglich – bitte den Text im Feld markieren und kopieren.", { isError: true });
    }
  }

  return (
    <s-page heading="Checkout & E-Mail">
      {d.b2bOnly && (
        <s-banner tone="info" heading="Nur B2B-Verkauf eingestellt">
          <s-paragraph>Danke-/Bestellstatusseite und Bestellbestätigung zeigen deshalb weder Mitteilung noch GARAN-Label.</s-paragraph>
        </s-banner>
      )}
      {result && "publishError" in result && (
        <s-banner tone="critical" heading="Bilder konnten nicht bereitgestellt werden">
          <s-paragraph>{result.publishError}</s-paragraph>
        </s-banner>
      )}
      {published && (
        <s-banner tone={published.failed.length ? "warning" : "success"} heading="Bilder bereitgestellt">
          <s-paragraph>
            Mitteilung in {published.languages} Sprachen, GARAN-Labels für {published.products} Produkte.
            {published.failed.length > 0 && ` Fehlgeschlagen: ${published.failed.map((x) => x.productId.split("/").pop()).join(", ")}.`}
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="1. Bilder bereitstellen">
        <s-stack gap="base">
          <s-paragraph>
            Danke-/Bestellstatusseite und E-Mails können keine Theme-Dateien laden. Die App legt die amtliche Mitteilung
            (alle 24 Sprachfassungen) und je Produkt das GARAN-Label als Bild in deinen Dateien (Inhalte &gt; Dateien) ab.
            GARAN-Bilder entstehen danach automatisch beim Speichern eines Produkts. Lösche diese Dateien nicht: Bereits
            versandte Bestellbestätigungen verweisen darauf.
          </s-paragraph>
          <s-text>Mitteilung: {ready ? `bereit (${d.languages} Sprachen)` : d.languages ? `${d.languages} von ${d.totalLanguages} Sprachen` : "noch nicht bereitgestellt"}</s-text>
          <s-text>Produkte mit GARAN-Label: {d.garanProducts}</s-text>
          {d.lastPublish && <s-text>Zuletzt bereitgestellt: {dateTime(d.lastPublish)}</s-text>}
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />
            <s-button type="submit" variant={ready ? "secondary" : "primary"} loading={busy("publish")}>
              {ready ? "Bilder aktualisieren" : "Bilder bereitstellen"}
            </s-button>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="2. Danke- und Bestellstatusseite">
        <s-stack gap="base">
          <s-paragraph>
            Füge im Checkout-Editor auf der Danke-Seite und auf der Bestellstatusseite den Block
            „EU-Gewährleistung: Mitteilung“ hinzu. Für GARAN-Labels direkt unter den Artikeln zusätzlich
            „EU-Gewährleistung: GARAN je Artikel“ an der Artikelliste. Die Anrede des Satzes stellst du im Block ein.
            Mit Shopify Plus kannst du beide Blöcke auch in die Checkout-Schritte setzen, also direkt vor die Bestellung.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href={d.links.thankYou} target="_top" variant="primary">Danke-Seite bearbeiten</s-button>
            <s-button href={d.links.orderStatus} target="_top">Bestellstatusseite bearbeiten</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="3. Bestellbestätigung (E-Mail)">
        <s-stack gap="base">
          <s-paragraph>
            Die Bestellbestätigung ist dein dauerhafter Nachweis gegenüber Kund:innen; Mitteilung und GARAN-Label gehören
            hinein. Öffne Einstellungen &gt; Benachrichtigungen &gt; Bestellbestätigung &gt; Code bearbeiten und füge den
            Baustein nach der Artikelliste ein (z. B. vor dem Abschnitt mit den Kundendaten). Er wählt die Sprache der
            Bestellung und liest Bilder und Texte aus der App – du musst ihn bei Änderungen nicht neu einfügen.
          </s-paragraph>
          <s-select label="Anrede im Satz zu den Gewährleistungsrechten" value={address}
            onChange={(e) => setAddress(e.currentTarget.value as Address)}>
            <s-option value="neutral">Ohne Anrede („Rechte aus der gesetzlichen Gewährleistung“)</s-option>
            <s-option value="formal">Sie („Ihre Rechte …“)</s-option>
            <s-option value="informal">Du („Deine Rechte …“)</s-option>
          </s-select>
          <s-text-area label="Baustein" value={snippet} readOnly rows={10} />
          <s-stack direction="inline" gap="base">
            <s-button onClick={copy} variant="primary">Baustein kopieren</s-button>
            <s-button href={d.links.notifications} target="_top">Benachrichtigungen öffnen</s-button>
          </s-stack>
          {!ready && !d.b2bOnly && (
            <s-paragraph tone="caution">Solange die Bilder (Schritt 1) fehlen, zeigt der Baustein nichts an.</s-paragraph>
          )}
          <Form method="post">
            {d.emailSnippetAt ? (
              <s-stack direction="inline" gap="base">
                <s-text>Eingefügt laut deiner Bestätigung am {dateTime(d.emailSnippetAt)}.</s-text>
                <input type="hidden" name="intent" value="email-unconfirm" />
                <s-button type="submit" variant="tertiary" loading={busy("email-unconfirm")}>Bestätigung zurücknehmen</s-button>
              </s-stack>
            ) : (
              <>
                <input type="hidden" name="intent" value="email-confirm" />
                <s-button type="submit" loading={busy("email-confirm")}>Ich habe den Baustein eingefügt</s-button>
              </>
            )}
          </Form>
          <s-paragraph>
            Prüfe das Ergebnis mit „Vorschau“ oder einer Testbestellung. Die Vorschau in Shopify nutzt Beispielartikel ohne
            GARAN-Angaben; GARAN-Labels siehst du nur in echten Bestellungen.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
