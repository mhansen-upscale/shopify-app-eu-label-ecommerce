import { gql, type AdminApiContext } from "./metafields.server";

// Bilder in Shopify Files (Scope write_files): Checkout-Extension und Bestellbestätigung brauchen feste, öffentliche
// URLs auf dem Shopify-CDN. Ablauf: stagedUploadsCreate -> Datei hochladen -> fileCreate -> warten, bis die Bild-URL steht.

export type ImageUpload = { filename: string; alt: string; data: Buffer };
export type UploadedFile = { fileId: string; url: string };
type UserError = { field?: string[]; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lädt PNGs hoch (gemeinsame Aufrufe für alle Dateien) und liefert ID und CDN-URL in derselben Reihenfolge. */
export async function uploadImages(admin: AdminApiContext, items: ImageUpload[], timeoutMs = 60_000): Promise<UploadedFile[]> {
  if (!items.length) return [];
  const staged = await gql<{
    stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: UserError[] };
  }>(admin, `#graphql
    mutation Staged($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`, {
    input: items.map((i) => ({ resource: "IMAGE", filename: i.filename, mimeType: "image/png", httpMethod: "POST", fileSize: String(i.data.length) })),
  });
  if (staged.stagedUploadsCreate.userErrors.length) throw new Error(staged.stagedUploadsCreate.userErrors.map((e) => e.message).join(", "));
  const targets = staged.stagedUploadsCreate.stagedTargets;

  await Promise.all(targets.map(async (t, k) => {
    const form = new FormData();
    for (const p of t.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([new Uint8Array(items[k].data)], { type: "image/png" }), items[k].filename);
    const res = await fetch(t.url, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload ${items[k].filename}: HTTP ${res.status}`);
  }));

  const created = await gql<{ fileCreate: { files: { id: string }[]; userErrors: UserError[] } }>(admin, `#graphql
    mutation Files($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id }
        userErrors { field message }
      }
    }`, {
    files: items.map((i, k) => ({
      originalSource: targets[k].resourceUrl, contentType: "IMAGE", alt: i.alt, filename: i.filename, duplicateResolutionMode: "APPEND_UUID",
    })),
  });
  if (created.fileCreate.userErrors.length) throw new Error(created.fileCreate.userErrors.map((e) => e.message).join(", "));
  const ids = created.fileCreate.files.map((f) => f.id);

  // Shopify verarbeitet Bilder asynchron; die CDN-URL gibt es erst bei fileStatus READY
  const urls = new Map<string, string>();
  for (const start = Date.now(); urls.size < ids.length; await sleep(1000)) {
    const open = ids.filter((id) => !urls.has(id));
    const files = await fileStatus(admin, open);
    for (const f of files) {
      if (f.status === "FAILED") throw new Error(`Datei ${f.id}: ${f.errors.join(", ") || "Verarbeitung fehlgeschlagen"}`);
      if (f.status === "READY" && f.url) urls.set(f.id, f.url);
    }
    if (urls.size < ids.length && Date.now() - start > timeoutMs) throw new Error("Shopify Files: Zeitüberschreitung bei der Bildverarbeitung");
  }
  return ids.map((fileId) => ({ fileId, url: urls.get(fileId)! }));
}

type FileState = { id: string; status: string; url: string | null; errors: string[] };

/** Status und URL von Dateien; fehlende (vom Händler gelöschte) Dateien kommen nicht zurück. */
export async function fileStatus(admin: AdminApiContext, ids: string[]): Promise<FileState[]> {
  const out: FileState[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const data = await gql<{ nodes: ({ id: string; fileStatus: string; image: { url: string } | null; fileErrors: { message: string }[] } | null)[] }>(admin, `#graphql
      query FileStatus($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on MediaImage { id fileStatus image { url } fileErrors { message } }
        }
      }`, { ids: ids.slice(i, i + 100) });
    for (const n of data.nodes) {
      if (n?.id) out.push({ id: n.id, status: n.fileStatus, url: n.image?.url ?? null, errors: n.fileErrors.map((e) => e.message) });
    }
  }
  return out;
}
