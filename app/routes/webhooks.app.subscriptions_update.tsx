import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logEvent } from "../lib/audit.server";

/**
 * Tarifwechsel (Managed Pricing) im Nachweis-Protokoll festhalten. Es wird nichts abgeschaltet: bestehende GARAN-Labels
 * bleiben nach einem Downgrade sichtbar, das Limit greift beim nächsten Speichern (app/lib/plan.server.ts).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const sub = (payload as { app_subscription?: { name?: string; status?: string } }).app_subscription;
  await logEvent(shop, "plan.changed", null, { name: sub?.name ?? null, status: sub?.status ?? null });
  return new Response();
};
