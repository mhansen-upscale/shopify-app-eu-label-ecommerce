import prisma from "../db.server";

/** Health-Check für Fly: prüft, ob App und Datenbank erreichbar sind. */
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response("ok", { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("db unavailable", { status: 503 });
  }
};
