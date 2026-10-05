import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopAndSettings, saveSettings, type Settings } from "../lib/metafields.server";
import { logEvent } from "../lib/audit.server";
import { publishNotice } from "../lib/publish.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { settings } = await getShopAndSettings(admin);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shopId } = await getShopAndSettings(admin);
  const f = await request.formData();

  const tags = String(f.get("excludeTags") ?? "")
    .split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  let collections: Settings["excludeCollections"] = [];
  try {
    collections = (JSON.parse(String(f.get("excludeCollections") ?? "[]")) as Settings["excludeCollections"])
      .filter((c) => /^gid:\/\/shopify\/Collection\/\d+$/.test(c.id)).slice(0, 50)
      .map((c) => ({ id: c.id, title: String(c.title ?? "").slice(0, 255) }));
  } catch { /* ungültige Eingabe -> keine Kollektionen */ }

  const settings: Settings = {
    b2bOnly: f.get("b2bOnly") === "true",
    excludeGiftCards: f.get("excludeGiftCards") === "true",
    excludeNoShipping: f.get("excludeNoShipping") === "true",
    excludeTags: [...new Set(tags)].slice(0, 50),
    excludeCollections: collections,
    excludeCollectionIds: collections.map((c) => c.id.split("/").pop()!),
    usedTag: String(f.get("usedTag") ?? "").trim().toLowerCase(),
    usedHint: String(f.get("usedHint") ?? "").trim().slice(0, 500),
  };

  await saveSettings(admin, shopId, settings);
  await logEvent(session.shop, "settings.saved", null, settings);
  // "Nur B2B" gilt auch für Checkout und Bestellbestätigung; lädt nichts hoch (nur bereits bereitgestellte Bilder)
  try {
    await publishNotice(admin, session.shop, shopId, settings, false);
  } catch (err) {
    await logEvent(session.shop, "publish.failed", null, { message: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true };
};

export default function SettingsPage() {
  const { settings: s } = useLoaderData<typeof loader>();
  const saved = useActionData<typeof action>()?.ok;
  const busy = useNavigation().state === "submitting";
  const [collections, setCollections] = useState(s.excludeCollections);

  async function pickCollections() {
    const selected = await shopify.resourcePicker({
      type: "collection", multiple: true, action: "select",
      selectionIds: collections.map((c) => ({ id: c.id })),
    });
    if (selected) setCollections(selected.map((c) => ({ id: c.id, title: (c as { title?: string }).title ?? c.id })));
  }

  return (
    <s-page heading="Einstellungen">
      <Form method="post">
        {saved && !busy && (
          <s-banner tone="success" heading="Einstellungen gespeichert" />
        )}

        <s-section heading="Gewährleistungsmitteilung">
          <s-stack gap="base">
            <s-paragraph>
              Die Mitteilung ist in jedem Tarif enthalten und erscheint bei allen Produkten. Sie gilt für den Verkauf von
              Waren an Verbraucher:innen; digitale Inhalte, Dienstleistungen und reine B2B-Verkäufe nimmst du hier aus.
            </s-paragraph>
            <s-checkbox name="b2bOnly" value="true" checked={s.b2bOnly}
              label="Nur B2B-Verkauf"
              details="Der Shop verkauft ausschließlich an Unternehmen. Dann gilt die Pflicht nicht; Mitteilung und GARAN-Label erscheinen nirgends." />
          </s-stack>
        </s-section>

        <s-section heading="Ausschlüsse">
          <s-stack gap="base">
            <s-checkbox name="excludeGiftCards" value="true" label="Geschenkgutscheine ausschließen" checked={s.excludeGiftCards} />
            <s-checkbox name="excludeNoShipping" value="true" label="Produkte ohne Versand ausschließen (digitale Waren, Dienstleistungen)" checked={s.excludeNoShipping} />
            <s-text-field
              name="excludeTags"
              label="Produkt-Tags ausschließen"
              details="Kommagetrennt, z. B. b2b, dienstleistung"
              value={s.excludeTags.join(", ")}
            />
            <input type="hidden" name="excludeCollections" value={JSON.stringify(collections)} />
            <s-stack gap="small-200">
              <s-text>Kollektionen ausschließen</s-text>
              {collections.length > 0 ? (
                <s-stack direction="inline" gap="small-200">
                  {collections.map((c) => (
                    <s-clickable-chip key={c.id} removable
                      onRemove={() => setCollections((prev) => prev.filter((x) => x.id !== c.id))}>
                      {c.title}
                    </s-clickable-chip>
                  ))}
                </s-stack>
              ) : (
                <s-text color="subdued">Keine Kollektion ausgeschlossen.</s-text>
              )}
              <s-button onClick={pickCollections}>Kollektionen auswählen</s-button>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="Gebrauchtware">
          <s-stack gap="base">
            <s-text-field name="usedTag" label="Tag für Gebrauchtware" details="Produkte mit diesem Tag bekommen zusätzlich deinen Hinweis." value={s.usedTag} />
            <s-text-area
              name="usedHint"
              label="Hinweis unter der Mitteilung"
              details="Z. B. zu einer vereinbarten kürzeren Frist, soweit nach nationalem Recht zulässig. Die amtliche Mitteilung selbst bleibt unverändert."
              value={s.usedHint}
              rows={3}
            />
          </s-stack>
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary" loading={busy}>Einstellungen speichern</s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
