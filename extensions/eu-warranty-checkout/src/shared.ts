// Lesen der von der App veröffentlichten Metafields (app/lib/publish.server.ts). Keine eigene Regel-Logik: Was die App
// nicht veröffentlicht hat, wird nicht angezeigt.

// Reihenfolge wie NOTICE_FIELDS in app/lib/publish.server.ts (tests/email-snippet.test.ts gleicht ab)
export const NOTICE_FIELDS = ["lang", "image", "notice_url", "notice_url_label", "title", "sentence_neutral",
  "sentence_formal", "sentence_informal", "garan_term", "garan_years", "garan_url", "garan_url_label", "enlarge", "dims"] as const;

export type NoticeRecord = Record<(typeof NOTICE_FIELDS)[number], string>;
export type Entry = { target: { type: string; id: string }; metafield: { key: string; value: unknown } };

// IDs kommen je nach Oberfläche als GID oder Zahl -> über die Zahl vergleichen
const num = (id: unknown) => String(id ?? "").split("/").pop();

const value = (entries: Entry[], type: string, key: string, id?: string) => {
  const e = entries.find((x) => x.target.type === type && x.metafield.key === key && (id === undefined || num(x.target.id) === num(id)));
  return typeof e?.metafield.value === "string" ? e.metafield.value : "";
};

/** Datensatz der Sprachfassung zur Sprache der Kund:innen; sonst der erste (Englisch). null = nichts veröffentlicht. */
export function noticeRecord(entries: Entry[], isoCode: string | undefined): NoticeRecord | null {
  const raw = value(entries, "shop", "notice");
  if (!raw) return null;
  const lang = (isoCode ?? "").slice(0, 2).toLowerCase();
  const records = raw.split("§").map((r) => r.split("|"));
  const fields = records.find((f) => f[0] === lang) ?? records[0];
  if (!fields?.[1]) return null;
  return Object.fromEntries(NOTICE_FIELDS.map((k, i) => [k, fields[i] ?? ""])) as NoticeRecord;
}

/** GARAN-Bild einer Position: eigene Angabe der Variante ("none" = kein Label), sonst das des Produkts. */
export function garanImage(entries: Entry[], productId: string, variantId: string): string | null {
  const own = value(entries, "variant", "garan_image", variantId);
  if (own === "none") return null;
  return own || value(entries, "product", "garan_image", productId) || null;
}

export function sentence(rec: NoticeRecord, address: unknown) {
  return address === "formal" ? rec.sentence_formal : address === "informal" ? rec.sentence_informal : rec.sentence_neutral;
}

/** Seitenverhältnis für s-image aus "1654x2283". */
export const aspectRatio = (dims: string) => (dims.replace("x", "/") || "1/1") as `${number}/${number}`;
