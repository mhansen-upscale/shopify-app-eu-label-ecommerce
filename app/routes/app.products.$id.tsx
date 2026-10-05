import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { gql, setMetafields, deleteMetafields, ensureDefinitions, NS, type MfInput, type MfValue } from "../lib/metafields.server";
import { publishGaran } from "../lib/publish.server";
import { logEvent } from "../lib/audit.server";
import { garanAllowed, garanQuota, getPlan, setGaranProduct } from "../lib/plan.server";
import { formatDuration, validateGaran, type GaranErrors } from "../lib/garan";

const gid = (id: string) => `gid://shopify/Product/${id}`;
const GARAN_KEYS = ["garan_confirmed", "garan_duration", "garan_brand", "garan_model"];
const MAX_VARIANTS = 100; // Abfragekosten; mehr Varianten pflegt man über den CSV-Import

type GaranMf = { confirmed: MfValue; duration: MfValue; brand: MfValue; model: MfValue };
type ProductData = {
  product: ({
    id: string; title: string; vendor: string; hasOnlyDefaultVariant: boolean;
    exclude: MfValue; used: MfValue;
    variants: { nodes: ({ id: string; title: string } & GaranMf)[] };
  } & GaranMf) | null;
};

const garanFields = `
  confirmed: metafield(namespace: "${NS}", key: "garan_confirmed") { value }
  duration: metafield(namespace: "${NS}", key: "garan_duration") { value }
  brand: metafield(namespace: "${NS}", key: "garan_brand") { value }
  model: metafield(namespace: "${NS}", key: "garan_model") { value }`;

const garanValues = (m: GaranMf) => ({
  confirmed: m.confirmed?.value === "true",
  duration: m.duration?.value ? formatDuration(Number(m.duration.value)) : "",
  brand: m.brand?.value ?? "",
  model: m.model?.value ?? "",
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = await gql<ProductData>(admin, `#graphql
    query P($id: ID!) {
      product(id: $id) {
        id title vendor hasOnlyDefaultVariant
        exclude: metafield(namespace: "${NS}", key: "exclude") { value }
        used: metafield(namespace: "${NS}", key: "used") { value }
        ${garanFields}
        variants(first: ${MAX_VARIANTS}) { nodes { id title ${garanFields} } }
      }
    }`, { id: gid(params.id!) });
  if (!data.product) throw new Response("Produkt nicht gefunden", { status: 404 });
  const p = data.product;
  const plan = await getPlan(admin);
  const [quota, allowed] = await Promise.all([garanQuota(session.shop, plan), garanAllowed(session.shop, p.id, plan)]);
  return {
    quota,
    garanLocked: allowed.ok ? null : allowed.reason,
    title: p.title,
    vendor: p.vendor,
    exclude: p.exclude?.value === "true",
    used: p.used?.value === "true",
    garan: garanValues(p),
    // Variante mit gesetztem garan_confirmed hat eigene Angaben ("false" = für diese Variante kein Label)
    variants: p.hasOnlyDefaultVariant ? [] : p.variants.nodes.map((v) => ({
      id: v.id, title: v.title,
      mode: v.confirmed?.value === undefined ? "inherit" : v.confirmed.value === "true" ? "own" : "none",
      garan: garanValues(v),
    })),
  };
};

type FieldErrors = GaranErrors & { confirmed?: string };

/** GARAN-Felder aus dem Formular lesen und prüfen (Präfix "" für das Produkt, "v<ID>." für Varianten). */
function readGaran(f: FormData, prefix: string) {
  const input = {
    duration: String(f.get(`${prefix}duration`) ?? ""),
    brand: String(f.get(`${prefix}brand`) ?? "").trim(),
    model: String(f.get(`${prefix}model`) ?? "").trim(),
  };
  const confirmed = f.get(`${prefix}confirmed`) === "true";
  const any = confirmed || !!(input.duration.trim() || input.brand || input.model);
  let errors: FieldErrors = {};
  let years: number | null = null;
  if (any) {
    ({ errors, years } = validateGaran(input));
    if (!confirmed) errors.confirmed = "Ohne diese Bestätigung darf das GARAN-Label nicht erscheinen.";
  }
  return { input, any, errors, years };
}

const garanSet = (ownerId: string, years: number, input: { brand: string; model: string }): MfInput[] => [
  { ownerId, key: "garan_confirmed", type: "boolean", value: "true" },
  { ownerId, key: "garan_duration", type: "number_decimal", value: String(years) },
  { ownerId, key: "garan_brand", type: "single_line_text_field", value: input.brand },
  { ownerId, key: "garan_model", type: "single_line_text_field", value: input.model },
];

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const f = await request.formData();
  const ownerId = gid(params.id!);

  const product = readGaran(f, "");
  const variantIds = (JSON.parse(String(f.get("variantIds") ?? "[]")) as string[])
    .filter((id) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id)).slice(0, MAX_VARIANTS);
  const variants = variantIds.map((id) => {
    const prefix = `v${id.split("/").pop()}.`;
    const mode = String(f.get(`${prefix}mode`) ?? "inherit");
    return { id, mode, ...(mode === "own" ? readGaran(f, prefix) : { input: null, any: false, errors: {}, years: null }) };
  });
  // Eigene Angaben einer Variante müssen vollständig sein (Bestätigung inklusive)
  for (const v of variants) if (v.mode === "own" && !v.any) v.errors = { confirmed: "Für eigene Angaben bitte bestätigen und ausfüllen." };

  const variantErrors = Object.fromEntries(variants.filter((v) => Object.keys(v.errors).length).map((v) => [v.id, v.errors]));
  if (Object.keys(product.errors).length || Object.keys(variantErrors).length) {
    return { errors: product.errors, variantErrors };
  }
  const hasGaran = product.any || variants.some((v) => v.mode === "own");
  if (hasGaran) {
    const allowed = await garanAllowed(session.shop, ownerId, await getPlan(admin));
    if (!allowed.ok) return { errors: { confirmed: allowed.reason } as FieldErrors, variantErrors: {} };
  }

  const set: MfInput[] = [];
  const del: { ownerId: string; key: string }[] = [];
  const flag = (key: string) => (f.get(key) === "true"
    ? set.push({ ownerId, key, type: "boolean", value: "true" })
    : del.push({ ownerId, key }));
  flag("exclude");
  flag("used");
  if (product.any && product.years !== null) set.push(...garanSet(ownerId, product.years, product.input));
  else del.push(...GARAN_KEYS.map((key) => ({ ownerId, key })));
  for (const v of variants) {
    if (v.mode === "own" && v.years !== null && v.input) set.push(...garanSet(v.id, v.years, v.input));
    else if (v.mode === "none") {
      set.push({ ownerId: v.id, key: "garan_confirmed", type: "boolean", value: "false" });
      del.push(...GARAN_KEYS.slice(1).map((key) => ({ ownerId: v.id, key })));
    } else del.push(...GARAN_KEYS.map((key) => ({ ownerId: v.id, key })));
  }

  await setMetafields(admin, set);
  await deleteMetafields(admin, del);
  await setGaranProduct(session.shop, ownerId, hasGaran);
  await logEvent(session.shop, "product.saved", ownerId, {
    set: set.map(({ ownerId: o, key, value }) => ({ owner: o, key, value })),
    deleted: del.map(({ ownerId: o, key }) => `${o}:${key}`),
  });
  // Bild für Checkout und Bestellbestätigung; scheitert das (z. B. Scope write_files noch nicht bestätigt), bleibt das
  // Gespeicherte gültig und die Seite "Checkout & E-Mail" holt es nach
  try {
    await ensureDefinitions(admin, session.shop);
    await publishGaran(admin, session.shop, ownerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(session.shop, "publish.failed", ownerId, { message });
    return { errors: {} as FieldErrors, variantErrors: {} as Record<string, FieldErrors>, publishError: message };
  }
  return redirect("/app/products");
};

type GaranState = { confirmed: boolean; duration: string; brand: string; model: string };

/** Eingabe der drei editierbaren Label-Felder samt Bestätigung, mit Live-Prüfung wie auf dem Server. */
function GaranFields({ prefix, initial, serverErrors, vendor }: { prefix: string; initial: GaranState; serverErrors: FieldErrors; vendor: string }) {
  const [fields, setFields] = useState({ duration: initial.duration, brand: initial.brand, model: initial.model });
  const [touched, setTouched] = useState(false);
  const live = validateGaran(fields).errors;
  const anyValue = !!(fields.duration.trim() || fields.brand.trim() || fields.model.trim());
  const err = (key: keyof GaranErrors) => (touched && anyValue ? live[key] : undefined) ?? serverErrors[key];
  const update = (key: keyof typeof fields) => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value;
    setFields((prev) => ({ ...prev, [key]: value }));
    setTouched(true);
  };
  return (
    <s-stack gap="base">
      <s-checkbox name={`${prefix}confirmed`} value="true" checked={initial.confirmed} error={serverErrors.confirmed}
        label="Qualifizierte Herstellergarantie vorhanden"
        details="Die Garantie kommt vom Hersteller, deckt die gesamte Ware ab, kostet nichts zusätzlich und läuft länger als 2 Jahre." />
      <s-text-field name={`${prefix}duration`} label="Garantiedauer in Jahren"
        details="Ganze Jahre, z. B. 3 oder 5. Halbe Jahre passen in voller Schriftgröße nicht ins Label."
        value={fields.duration} onInput={update("duration")} error={err("duration")} />
      <s-text-field name={`${prefix}brand`} label="Marke / Hersteller" value={fields.brand} placeholder={vendor}
        onInput={update("brand")} error={err("brand")} />
      <s-text-field name={`${prefix}model`} label="Modellkennung" value={fields.model}
        details="Steht so auf dem Label. Marke und Modellkennung teilen sich eine Zeile mit fester Schriftgröße."
        onInput={update("model")} error={err("model")} />
    </s-stack>
  );
}

function VariantRow({ v, errors, vendor }: { v: { id: string; title: string; mode: string; garan: GaranState }; errors: FieldErrors; vendor: string }) {
  const [mode, setMode] = useState(v.mode);
  const prefix = `v${v.id.split("/").pop()}.`;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-select label={v.title} name={`${prefix}mode`} value={mode}
          onChange={(e) => setMode(e.currentTarget.value)}>
          <s-option value="inherit">Wie das Produkt</s-option>
          <s-option value="own">Eigene GARAN-Angaben</s-option>
          <s-option value="none">Kein GARAN-Label</s-option>
        </s-select>
        {mode === "own" && <GaranFields prefix={prefix} initial={v.garan} serverErrors={errors} vendor={vendor} />}
      </s-stack>
    </s-box>
  );
}

export default function ProductEdit() {
  const p = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";

  return (
    <s-page heading={p.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">Produkte</s-link>
      <Form method="post">
        {result && "publishError" in result && (
          <s-banner tone="warning" heading="Gespeichert – Bild für Checkout und E-Mail fehlt noch">
            <s-paragraph>
              Die Angaben sind gespeichert und erscheinen im Shop. Das GARAN-Bild für Danke-/Bestellstatusseite und
              Bestellbestätigung konnte nicht erstellt werden ({result.publishError}). Unter „Checkout &amp; E-Mail“ kannst du
              die Bilder erneut bereitstellen.
            </s-paragraph>
          </s-banner>
        )}
        <s-section heading="Gesetzliche Gewährleistung">
          <s-stack gap="base">
            <s-checkbox name="exclude" value="true" checked={p.exclude}
              label="Kein EU-Label für dieses Produkt"
              details="Nur wenn es keine Ware für Verbraucher:innen ist, z. B. Dienstleistung oder B2B." />
            <s-checkbox name="used" value="true" checked={p.used} label="Gebrauchtware (zeigt deinen Hinweis aus den Einstellungen)" />
          </s-stack>
        </s-section>

        <s-section heading="GARAN-Herstellergarantie">
          {p.garanLocked && (
            <s-banner tone="warning" heading="GARAN-Kontingent ausgeschöpft">
              <s-paragraph>{p.garanLocked}</s-paragraph>
            </s-banner>
          )}
          <s-paragraph>
            Nur ausfüllen, wenn der Hersteller eine Haltbarkeitsgarantie gewährt. Leer lassen, wenn es keine solche Garantie gibt.
            Produkte mit GARAN-Label: {p.quota.used} von {p.quota.limit ?? "unbegrenzt"}.
          </s-paragraph>
          <GaranFields prefix="" initial={p.garan} serverErrors={result?.errors ?? {}} vendor={p.vendor} />
        </s-section>

        {p.variants.length > 0 && (
          <s-section heading="Varianten">
            <s-stack gap="base">
              <s-paragraph>
                Varianten zeigen das GARAN-Label des Produkts. Hat eine Variante eine andere Garantie (z. B. anderes Modell),
                hinterlege hier eigene Angaben; das Label im Shop wechselt mit der gewählten Variante.
              </s-paragraph>
              <input type="hidden" name="variantIds" value={JSON.stringify(p.variants.map((v) => v.id))} />
              {p.variants.map((v) => (
                <VariantRow key={v.id} v={v} errors={result?.variantErrors?.[v.id] ?? {}} vendor={p.vendor} />
              ))}
            </s-stack>
          </s-section>
        )}

        <s-section>
          <s-button type="submit" variant="primary" loading={busy}>Produkt speichern</s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
