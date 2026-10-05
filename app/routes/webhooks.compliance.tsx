import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Pflicht-Webhooks für den App Store (DSGVO).
 * Die App speichert keine Kundendaten; bei shop/redact werden alle Shop-Daten gelöscht.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request); // prüft HMAC, sonst 401

  if (topic === "SHOP_REDACT") {
    await prisma.$transaction([
      prisma.complianceEvent.deleteMany({ where: { shop } }),
      prisma.garanProduct.deleteMany({ where: { shop } }),
      prisma.renderedFile.deleteMany({ where: { shop } }),
      prisma.shopConfig.deleteMany({ where: { shop } }),
      prisma.session.deleteMany({ where: { shop } }),
    ]);
  }
  // CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT: keine Kundendaten gespeichert -> nichts zu tun
  return new Response();
};
