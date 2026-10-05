// Liquid-Umgebung für den Theme-Block (Vorschau und Tests) mit liquidjs. Nachgebildete Shopify-Besonderheiten:
// asset_url, stylesheet_tag, {% schema %} und Ganzzahl-Division bei divided_by.
import path from "node:path";
import { Liquid, Tag } from "liquidjs";

export const EXT = path.resolve("extensions/eu-warranty-label");

export function createEngine() {
  const engine = new Liquid({ root: [path.join(EXT, "snippets"), path.join(EXT, "blocks")], extname: ".liquid", strictFilters: true });
  engine.registerFilter("asset_url", (file) => `assets/${file}`);
  engine.registerFilter("stylesheet_tag", (url) => `<link href="${url}" rel="stylesheet" type="text/css" media="all">`);
  // Shopify: Ganzzahl geteilt durch Ganzzahl ergibt eine Ganzzahl (abgerundet)
  engine.registerFilter("divided_by", (a, b) => (Number.isInteger(Number(a)) && Number.isInteger(Number(b)) ? Math.floor(a / b) : a / b));
  engine.registerTag("schema", class extends Tag {
    constructor(token, remainTokens, liquid) {
      super(token, remainTokens, liquid);
      while (remainTokens.length) { const t = remainTokens.shift(); if (t.name === "endschema") return; }
    }
    * render() {}
  });
  return engine;
}

/** Kontext wie im Shop: Einstellungen und Produktangaben im app-eigenen Namespace. */
export function blockContext({ locale = "de", settings = {}, product = {}, metafields = {}, variants = [], block = {}, id = "test",
  template = "product", cart = null }) {
  const mf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
  const variantList = variants.map((v) => ({ title: "Variante", requires_shipping: true, ...v, metafields: { "$app:eu_warranty": mf(v.metafields ?? {}) } }));
  const p = {
    title: "Testprodukt", tags: [], "gift_card?": false, collections: [], has_only_default_variant: variantList.length === 0,
    variants: variantList, selected_or_first_available_variant: variantList[0] ?? { id: 1, requires_shipping: true, metafields: {} },
    ...product,
    metafields: { "$app:eu_warranty": mf(metafields) },
  };
  return {
    shop: { metafields: { "$app:eu_warranty": { settings: { value: {
      b2bOnly: false, excludeGiftCards: true, excludeNoShipping: true, excludeTags: [], excludeCollectionIds: [], usedTag: "", usedHint: "",
      ...settings } } } } },
    product: p,
    request: { locale: { iso_code: locale } },
    template: { name: template },
    cart: cart ?? { item_count: 0, items: [] },
    block: {
      id: `blk-${id}`, shopify_attributes: "",
      settings: { show_notice: true, show_garan: true, enable_zoom: true, notice_display: "collapsed", address: "neutral",
        garan_display: "nested", alignment: "left", max_width: 560, on_cart: true, position: "footer", ...block },
    },
  };
}

/** Rendert einen Block; globale Shopify-Objekte (request, template, cart, shop) stehen wie im Shop auch in Snippets bereit. */
export function renderBlock(engine, file, ctx) {
  const { request, template, cart, shop } = ctx;
  return engine.renderFile(file, ctx, { globals: { request, template, cart, shop } });
}
