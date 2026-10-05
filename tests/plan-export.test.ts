import assert from "node:assert/strict";
import prisma from "../app/db.server";
import { garanAllowed, garanQuota, getPlan, setGaranProduct } from "../app/lib/plan.server";
import { gql } from "../app/lib/metafields.server";
import { loader as exportLoader } from "../app/routes/app.export";

const SHOP = "claude-logiktest.myshopify.com";
type Call = { query: string; vars?: any };
function mockAdmin(handlers: [RegExp, (v: any) => any][], calls: Call[] = []) {
  return {
    calls,
    graphql: async (query: string, opts?: { variables?: any }) => {
      calls.push({ query, vars: opts?.variables });
      for (const [re, fn] of handlers) if (re.test(query)) {
        const r = fn(opts?.variables);
        if (r instanceof Error) throw r;
        return new Response(JSON.stringify({ data: r }));
      }
      throw new Error("Unerwartete Abfrage: " + query.slice(0, 80));
    },
  };
}
const subs = (name?: string) => [/currentAppInstallation/, () => ({ currentAppInstallation: { activeSubscriptions: name ? [{ name, status: "ACTIVE" }] : [] } })] as [RegExp, any];
const shopQ = (settings: object | null) => [/shop \{ id name/, () => ({ shop: { id: "gid://shopify/Shop/1", name: "Test", myshopifyDomain: SHOP, metafield: settings ? { value: JSON.stringify(settings) } : null } })] as [RegExp, any];

async function reset() {
  await prisma.garanProduct.deleteMany({ where: { shop: SHOP } });
  await prisma.complianceEvent.deleteMany({ where: { shop: SHOP } });
}
async function seed(n: number) {
  for (let i = 1; i <= n; i++) {
    await prisma.garanProduct.create({ data: { shop: SHOP, productId: "gid://shopify/Product/" + i, createdAt: new Date(Date.UTC(2026, 0, i)) } });
  }
}
const results: string[] = [];
const t = async (name: string, fn: () => Promise<void>) => { await fn(); results.push("✓ " + name); };

try {
  const plan = async (name?: string) => getPlan(mockAdmin([subs(name)]));

  await t("Free: 5 GARAN-Produkte, das 6. wird abgelehnt, bestehende bleiben bearbeitbar", async () => {
    await reset(); await seed(5);
    const free = await plan();
    assert.deepEqual(await garanQuota(SHOP, free), { used: 5, limit: 5, full: true, over: false });
    const neu = await garanAllowed(SHOP, "gid://shopify/Product/99", free);
    assert.equal(neu.ok, false); assert.match((neu as any).reason, /alle sind belegt/);
    assert.equal((await garanAllowed(SHOP, "gid://shopify/Product/3", free)).ok, true);
  });

  await t("Downgrade (12 bei Free): nichts wird abgeschaltet, Änderungen und Neuanlage gesperrt", async () => {
    await reset(); await seed(12);
    const free = await plan();
    const q = await garanQuota(SHOP, free);
    assert.equal(q.over, true); assert.equal(q.used, 12);
    const r = await garanAllowed(SHOP, "gid://shopify/Product/3", free);
    assert.equal(r.ok, false); assert.match((r as any).reason, /bleiben im Shop sichtbar/);
    assert.equal(await prisma.garanProduct.count({ where: { shop: SHOP } }), 12, "keine Labels entfernt");
  });

  await t("Entfernen senkt die Zählung, danach wieder im Limit", async () => {
    for (let i = 6; i <= 12; i++) await setGaranProduct(SHOP, "gid://shopify/Product/" + i, false);
    const free = await plan();
    assert.deepEqual(await garanQuota(SHOP, free), { used: 5, limit: 5, full: true, over: false });
    assert.equal((await garanAllowed(SHOP, "gid://shopify/Product/2", free)).ok, true);
    await setGaranProduct(SHOP, "gid://shopify/Product/2", true); // doppelt speichern zählt nicht doppelt
    assert.equal((await garanQuota(SHOP, free)).used, 5);
  });

  await t("Scale: unbegrenzt", async () => {
    await reset(); await seed(150);
    const scale = await plan("Scale");
    assert.deepEqual(await garanQuota(SHOP, scale), { used: 150, limit: null, full: false, over: false });
    assert.equal((await garanAllowed(SHOP, "gid://shopify/Product/999", scale)).ok, true);
  });

  await t("Unbekannter Abo-Name fällt auf Free zurück", async () => {
    assert.equal((await plan("Irgendwas")).name, "Free");
  });

  await t("Drosselung (THROTTLED): wartet und wiederholt", async () => {
    let n = 0;
    const throttled = Object.assign(new Error("Throttled"), { body: {
      errors: { graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
      extensions: { cost: { requestedQueryCost: 882, throttleStatus: { currentlyAvailable: 800, restoreRate: 100 } } } } });
    const admin = mockAdmin([[/shop/, () => (++n === 1 ? throttled : { shop: { ok: true } })]]);
    const t0 = Date.now();
    const data = await gql<{ shop: { ok: boolean } }>(admin, "query { shop { ok } }");
    const ms = Date.now() - t0;
    assert.equal(data.shop.ok, true);
    assert.equal(n, 2);
    assert.ok(ms >= 1000 && ms < 1600, "Wartezeit " + ms);
  });

  await t("Andere GraphQL-Fehler werden nicht wiederholt", async () => {
    let n = 0;
    const admin = mockAdmin([[/shop/, () => { n++; return Object.assign(new Error("Bad"), { body: { errors: { graphQLErrors: [{ message: "x" }] } } }); }]]);
    await assert.rejects(gql(admin, "query { shop { ok } }"));
    assert.equal(n, 1);
  });

  const prod = (id: number, o: any = {}) => ({
    id: "gid://shopify/Product/" + id, title: "P" + id, tags: o.tags ?? [], isGiftCard: !!o.gift,
    variants: { nodes: [{ inventoryItem: { requiresShipping: o.ship ?? true } }] },
    exclude: o.exclude ? { value: "true" } : null,
    used: o.used ? { value: "true" } : null, confirmed: o.years ? { value: "true" } : null, duration: o.years ? { value: String(o.years) } : null,
    brand: o.years ? { value: "Bosch" } : null, model: o.years ? { value: "GSR" } : null,
  });
  const runExport = async (settings: object | null, pages: any[][], failOnPage?: number, collections: Record<string, string[]> = {}) => {
    let page = 0;
    const admin = mockAdmin([shopQ(settings), [/query C\(/, (v) => ({ collection: { products: {
      pageInfo: { hasNextPage: false, endCursor: null }, nodes: (collections[v.id] ?? []).map((id) => ({ id })) } } })],
    [/query Export/, () => {
      const i = page++;
      if (failOnPage === i) return Object.assign(new Error("Boom"), { body: { errors: { graphQLErrors: [{ message: "Boom" }] } } });
      return { products: { pageInfo: { hasNextPage: i < pages.length - 1, endCursor: "c" + i }, nodes: pages[i] } };
    }]]);
    (globalThis as any).__mockAuth = { admin, session: { shop: SHOP } };
    const res = await exportLoader({ request: new Request("http://x/app/export"), params: {}, context: {} } as any);
    return { res, admin };
  };

  await t("Export: Regeln wie im Theme-Block (Versand, Tags, Gutschein, Kollektion), 2 Seiten mit Cursor", async () => {
    await reset();
    const settings = { excludeGiftCards: true, excludeNoShipping: true, excludeTags: ["b2b"], usedTag: "gebraucht",
      excludeCollections: [{ id: "gid://shopify/Collection/7", title: "Dienstleistungen" }] };
    const { res, admin } = await runExport(settings, [
      [prod(1, { years: 5 }), prod(2, { ship: false }), prod(3, { tags: ["B2B"] })],
      [prod(4), prod(5, { gift: true }), prod(6, { tags: ["Gebraucht"] })],
    ], undefined, { "gid://shopify/Collection/7": ["gid://shopify/Product/4"] });
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8-BOM für Excel");
    const text = new TextDecoder().decode(bytes);
    const rows = text.trim().split("\r\n").map((l) => l.split(";").map((c) => c.slice(1, -1)));
    const byId = Object.fromEntries(rows.slice(1).map((r) => [r[1].split("/").pop(), r]));
    assert.deepEqual([byId["1"][3], byId["1"][4], byId["1"][6], byId["1"][7]], ["ja", "nein", "ja", "5"]);
    assert.deepEqual([byId["2"][3], byId["2"][4]], ["nein", "ja"], "ohne Versand");
    assert.deepEqual([byId["3"][3], byId["3"][4]], ["nein", "ja"], "Tag b2b");
    assert.deepEqual([byId["4"][3], byId["4"][4]], ["nein", "ja"], "Kollektion ausgeschlossen");
    assert.deepEqual([byId["5"][3], byId["5"][4]], ["nein", "ja"], "Gutschein");
    assert.deepEqual([byId["6"][3], byId["6"][5]], ["ja", "ja"], "Gebraucht-Tag");
    const ex = admin.calls.filter((c) => /query Export/.test(c.query));
    assert.deepEqual(ex.map((c) => c.vars.after), [null, "c0"]);
  });

  await t("Export: Nur B2B -> nirgends 'Label aktiv'", async () => {
    const { res } = await runExport({ b2bOnly: true }, [[prod(1)]]);
    const row = (await res.text()).trim().split("\r\n")[1];
    assert.match(row, /"P1";"nein";"ja"/);
  });

  await t("Export: nicht eingerichteter Shop -> nirgends 'Label aktiv'", async () => {
    const { res } = await runExport(null, [[prod(1)]]);
    const row = (await res.text()).trim().split("\r\n")[1];
    assert.match(row, /"P1";"nein"/);
  });

  await t("Export: Fehler auf Seite 2 bricht den Download ab statt eine halbe Datei zu liefern", async () => {
    const { res } = await runExport({}, [[prod(1)], [prod(2)]], 1);
    await assert.rejects(res.text());
  });
} finally {
  await reset();
  await prisma.$disconnect();
}
console.log(results.join("\n"));
console.log(results.length + " Tests bestanden");
