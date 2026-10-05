import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { aspectRatio, garanImage, noticeRecord, sentence, type Entry } from './shared';

// Danke-Seite, Bestellstatusseite und (Shopify Plus) Checkout-Schritte. Die amtlichen Grafiken sind Bilder aus Shopify
// Files; ein Klick auf die Grafik öffnet sie in voller Auflösung (lesbar auch auf kleinen Bildschirmen).
export default async () => {
  render(<Block />, document.body);
};

// Seitenverhältnis von garan-full-template.png (app/lib/render.server.ts)
const GARAN_ASPECT = '1100/1158';

function Block() {
  const entries = shopify.appMetafields.value as Entry[];
  const rec = noticeRecord(entries, shopify.localization.language.value?.isoCode);
  if (!rec) return null; // nicht eingerichtet oder "nur B2B"
  const settings = shopify.settings.value as { display?: string; address?: string; hide_garan?: boolean };
  const text = sentence(rec, settings.address);

  const seen = new Set<string>();
  const garan = settings.hide_garan ? [] : shopify.lines.value.flatMap((line) => {
    const m = line.merchandise;
    const url = garanImage(entries, m.product.id, m.id);
    const title = m.subtitle ? `${m.title} – ${m.subtitle}` : m.title;
    if (!url || seen.has(url + title)) return [];
    seen.add(url + title);
    return [{ key: line.id, url, title }];
  });

  const notice = (
    <s-stack gap="small-200">
      <s-clickable href={rec.image} target="_blank" accessibilityLabel={`${rec.title} – ${rec.enlarge}`}>
        <s-image src={rec.image} alt={rec.title} aspectRatio={aspectRatio(rec.dims)} inlineSize="fill" />
      </s-clickable>
      {/* Klickbarer Link zum Ziel des QR-Codes (Praxisleitlinien 2.3) */}
      <s-link href={rec.notice_url} target="_blank" lang={rec.lang}>{rec.notice_url_label}</s-link>
    </s-stack>
  );

  return (
    <s-stack gap="base">
      {settings.display === 'full' ? (
        <s-stack gap="small-200">
          <s-heading>{text}</s-heading>
          {notice}
        </s-stack>
      ) : (
        // Eingeklappt als Satz zu den Gewährleistungsrechten, Mitteilung beim ersten Klick (Praxisleitlinien 2.3)
        <s-details>
          <s-summary>{text}</s-summary>
          {notice}
        </s-details>
      )}
      {garan.map((g) => (
        <s-stack key={g.key} gap="small-200">
          <s-text type="strong">{g.title}</s-text>
          <s-box maxInlineSize="360px">
            <s-clickable href={g.url} target="_blank" accessibilityLabel={`GARAN – ${rec.garan_years}: ${g.title} – ${rec.enlarge}`}>
              <s-image src={g.url} alt={`GARAN – ${rec.garan_years}`} aspectRatio={GARAN_ASPECT} inlineSize="fill" />
            </s-clickable>
          </s-box>
          <s-text>
            {rec.garan_term}: <s-link href={rec.garan_url} target="_blank">{rec.garan_url_label}</s-link>
          </s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}
