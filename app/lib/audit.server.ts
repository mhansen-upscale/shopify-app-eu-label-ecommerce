import prisma from "../db.server";

/** Nachweis-Protokoll: wer hat wann was am Label geändert (ohne Kundendaten). */
export function logEvent(shop: string, type: string, subject: string | null, payload: unknown) {
  return prisma.complianceEvent.create({
    data: { shop, type, subject, payload: JSON.stringify(payload) },
  });
}
