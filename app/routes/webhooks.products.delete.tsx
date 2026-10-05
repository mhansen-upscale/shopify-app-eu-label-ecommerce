import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { setGaranProduct } from "../lib/plan.server";

/** Gelöschte Produkte aus der GARAN-Zählung (Tariflimit) nehmen. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const id = (payload as { id?: number | string }).id;
  if (id !== undefined) await setGaranProduct(shop, `gid://shopify/Product/${id}`, false);
  return new Response();
};
