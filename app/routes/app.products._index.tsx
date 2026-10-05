import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { gql, getShopAndSettings, NS, type MfValue } from "../lib/metafields.server";
import { garanQuota, getPlan } from "../lib/plan.server";
import { formatDuration } from "../lib/garan";

type ProductsPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string; title: string; status: string; tags: string[]; isGiftCard: boolean;
      exclude: MfValue; confirmed: MfValue; duration: MfValue;
    }[];
  };
};

const PRODUCTS = `#graphql
  query Products($after: String, $query: String) {
    products(first: 50, after: $after, query: $query, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title status tags isGiftCard
        exclude: metafield(namespace: "${NS}", key: "exclude") { value }
        confirmed: metafield(namespace: "${NS}", key: "garan_confirmed") { value }
        duration: metafield(namespace: "${NS}", key: "garan_duration") { value }
      }
    }
  }`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const [data, { settings }, plan] = await Promise.all([
    gql<ProductsPage>(admin, PRODUCTS, { after: url.searchParams.get("after"), query: url.searchParams.get("q") || null }),
    getShopAndSettings(admin),
    getPlan(admin),
  ]);
  const quota = await garanQuota(session.shop, plan);
  return {
    products: data.products.nodes.map((p) => {
      const tags = p.tags.map((t) => t.toLowerCase());
      // Schnellansicht ohne Kollektionen und Versandart; vollständig nach den Regeln des Blocks prüft der CSV-Nachweis
      const excluded = settings.b2bOnly || p.exclude?.value === "true" || (settings.excludeGiftCards && p.isGiftCard) ||
        tags.some((t) => settings.excludeTags.includes(t));
      return {
        id: p.id,
        numericId: p.id.split("/").pop(),
        title: p.title,
        status: p.status,
        excluded,
        garan: p.confirmed?.value === "true" && p.duration?.value ? `${formatDuration(Number(p.duration.value))} Jahre` : null,
      };
    }),
    pageInfo: data.products.pageInfo,
    quota,
    b2bOnly: settings.b2bOnly,
    hasCollectionRules: settings.excludeCollections.length > 0 || settings.excludeNoShipping,
  };
};

export default function Products() {
  const d = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();

  return (
    <s-page heading="Produkte">
      <s-section>
        <s-stack gap="small-200">
          <s-paragraph>
            Die Gewährleistungsmitteilung erscheint bei allen Produkten außer den ausgeschlossenen. Das GARAN-Label trägst du
            beim jeweiligen Produkt ein: {d.quota.used} von {d.quota.limit ?? "unbegrenzt"} Produkten mit GARAN-Label.
          </s-paragraph>
          {d.hasCollectionRules && (
            <s-text color="subdued">Ausschlüsse nach Kollektion oder Versandart sind in dieser Liste nicht berücksichtigt.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Alle Produkte">
        <s-stack gap="base">
          <s-search-field
            label="Produkte suchen"
            placeholder="Titel suchen"
            value={params.get("q") ?? ""}
            onChange={(e) => setParams(e.currentTarget.value ? { q: `title:*${e.currentTarget.value}*` } : {})}
          />
          <s-table>
            <s-table-header-row>
              <s-table-header>Produkt</s-table-header>
              <s-table-header>Mitteilung</s-table-header>
              <s-table-header>GARAN</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.products.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>{p.title}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={p.excluded ? "neutral" : "success"}>{p.excluded ? "Ausgeschlossen" : "Wird angezeigt"}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{p.garan ?? "–"}</s-table-cell>
                  <s-table-cell>
                    <s-button href={`/app/products/${p.numericId}`}>Bearbeiten</s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {d.pageInfo.hasNextPage && d.pageInfo.endCursor && (
            <s-button onClick={() => setParams({ ...Object.fromEntries(params), after: d.pageInfo.endCursor ?? "" })}>
              Weitere Produkte
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
