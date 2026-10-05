// Testlauf mit vite-node: app/shopify.server wird durch einen Mock ersetzt (authenticate.admin liefert den Test-Admin)
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export default { resolve: { alias: [{ find: /^.*\/shopify\.server$/, replacement: path.join(here, "mock-shopify.ts") }] } };
