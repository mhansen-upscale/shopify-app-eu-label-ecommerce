import prisma from "../db.server";
import { gql, type AdminApiContext } from "./metafields.server";

/**
 * Tarife laufen über Shopify "Managed Pricing" (Partner Dashboard -> App -> Pricing).
 * Die Plan-Namen dort müssen exakt diesen Schlüsseln entsprechen.
 * Die gesetzliche Gewährleistungsmitteilung ist in jedem Tarif shopweit enthalten; die Limits gelten nur für
 * Produkte mit GARAN-Label.
 */
export const PLANS: Record<string, { limit: number; label: string }> = {
  Free: { limit: 5, label: "Kostenlos" },
  Start: { limit: 100, label: "Start" },
  Growth: { limit: 500, label: "Growth" },
  Scale: { limit: Infinity, label: "Scale" },
};

export type Plan = Awaited<ReturnType<typeof getPlan>>;

export async function getPlan(admin: AdminApiContext) {
  const data = await gql<{ currentAppInstallation: { activeSubscriptions: { name: string; status: string }[] } }>(admin, `#graphql
    query { currentAppInstallation { activeSubscriptions { name status } } }`);
  const active = data.currentAppInstallation.activeSubscriptions.find((s) => s.status === "ACTIVE");
  const name = active && PLANS[active.name] ? active.name : "Free";
  return { name, ...PLANS[name], unlimited: PLANS[name].limit === Infinity };
}

/** Produkte mit GARAN-Label im Verhältnis zum Tariflimit. */
export async function garanQuota(shop: string, plan: Plan) {
  const used = await prisma.garanProduct.count({ where: { shop } });
  return {
    used,
    limit: plan.unlimited ? null : plan.limit,
    full: !plan.unlimited && used >= plan.limit,
    // nach einem Downgrade: mehr Labels als erlaubt
    over: !plan.unlimited && used > plan.limit,
  };
}

/**
 * Darf dieses Produkt GARAN-Angaben erhalten oder ändern? Entfernen ist immer erlaubt.
 * Nach einem Downgrade bleiben bestehende Labels sichtbar (liegen die Herstellerangaben vor, ist das Label für den
 * Händler Pflicht); gesperrt werden nur Neuanlage und Änderungen, bis der Shop wieder im Limit liegt.
 */
export async function garanAllowed(shop: string, productId: string, plan: Plan): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (plan.unlimited) return { ok: true };
  const q = await garanQuota(shop, plan);
  const has = await prisma.garanProduct.findUnique({ where: { shop_productId: { shop, productId } } });
  if (has && !q.over) return { ok: true };
  if (!has && !q.full) return { ok: true };
  return {
    ok: false,
    reason: has
      ? `Dein Tarif umfasst ${plan.limit} Produkte mit GARAN-Label, hinterlegt sind ${q.used}. Bestehende Labels bleiben im Shop sichtbar; ändern kannst du sie nach einem Tarifwechsel oder wenn du bei anderen Produkten die GARAN-Angaben entfernst.`
      : `Dein Tarif umfasst ${plan.limit} Produkte mit GARAN-Label, alle sind belegt. Wechsle den Tarif oder entferne die GARAN-Angaben bei einem anderen Produkt.`,
  };
}

/** Zählung nachführen, nachdem GARAN-Angaben gespeichert oder entfernt wurden. */
export async function setGaranProduct(shop: string, productId: string, hasGaran: boolean) {
  if (hasGaran) {
    await prisma.garanProduct.upsert({ where: { shop_productId: { shop, productId } }, create: { shop, productId }, update: {} });
  } else {
    await prisma.garanProduct.deleteMany({ where: { shop, productId } });
  }
}

/** Link zur Managed-Pricing-Seite im Shopify-Admin. APP_HANDLE = Handle aus dem Partner Dashboard. */
export function pricingUrl(shopDomain: string) {
  const store = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/charges/${process.env.APP_HANDLE ?? "eu-gewaehrleistungslabel"}/pricing_plans`;
}
