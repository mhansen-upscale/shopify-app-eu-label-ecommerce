// Typen des globalen "shopify" je Ziel. Shopify CLI erzeugt diese Datei bei "shopify app dev" neu (gleicher Inhalt).
import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Block.tsx' {
  const shopify:
    | import('@shopify/ui-extensions/purchase.thank-you.block.render').Api
    | import('@shopify/ui-extensions/customer-account.order-status.block.render').Api
    | import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
