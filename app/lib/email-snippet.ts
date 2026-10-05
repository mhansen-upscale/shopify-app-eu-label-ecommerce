// Baustein für die Bestellbestätigung (Einstellungen > Benachrichtigungen > Bestellbestätigung > Code bearbeiten).
// Er enthält keine Bilder oder Texte, sondern liest die von der App gepflegten Metafields (app/lib/publish.server.ts):
// ändern sich Grafiken, Übersetzungen oder GARAN-Angaben, muss der Händler nichts neu einfügen.
// Außerhalb der Theme-Extension gilt der volle Namespace app--<App-ID>--eu_warranty statt $app:eu_warranty.
// Nur klassische Tags (kein {% liquid %}), damit der Baustein in jeder Version der Benachrichtigungs-Vorlagen läuft.
// Feld-Indizes wie NOTICE_FIELDS in publish.server.ts (Test: tests/email-snippet.test.ts).

export type Address = "neutral" | "formal" | "informal";
const SENTENCE_INDEX: Record<Address, number> = { neutral: 5, formal: 6, informal: 7 };

export function emailSnippet(appId: string, address: Address = "neutral") {
  if (!/^\d+$/.test(appId)) throw new Error("App-ID muss numerisch sein");
  const s = SENTENCE_INDEX[address];
  return `{%- comment -%}
  EU-Gewährleistungslabel: Mitteilung zum gesetzlichen Gewährleistungsrecht (VO (EU) 2025/1960) und GARAN-Label je
  Artikel. Bilder und Texte kommen aus der App – bei Änderungen muss dieser Baustein nicht neu eingefügt werden.
{%- endcomment -%}
{%- assign euw_ns = 'app--${appId}--eu_warranty' -%}
{%- assign euw_mf = shop.metafields[euw_ns].notice -%}
{%- assign euw_data = euw_mf.value | default: euw_mf | append: '' -%}
{%- assign euw_lang = order.customer_locale | default: customer_locale | append: '' | slice: 0, 2 | downcase -%}
{%- assign euw_rec = '' -%}
{%- assign euw_all = euw_data | split: '§' -%}
{%- for euw_r in euw_all -%}
  {%- assign euw_f = euw_r | split: '|' -%}
  {%- if forloop.first or euw_f[0] == euw_lang -%}{%- assign euw_rec = euw_r -%}{%- endif -%}
{%- endfor -%}
{%- if euw_rec != '' -%}
{%- assign euw = euw_rec | split: '|' -%}
<table style="width:100%;border-spacing:0;border-collapse:collapse;margin-top:32px" lang="{{ euw[0] }}">
  <tr>
    <td style="padding:0">
      <h3 style="font-weight:normal;font-size:20px;margin:0 0 12px">{{ euw[${s}] | escape }}</h3>
      <a href="{{ euw[1] | escape }}" target="_blank"><img src="{{ euw[1] | escape }}" alt="{{ euw[4] | escape }}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0"></a>
      <p style="margin:8px 0 0;font-size:14px"><a href="{{ euw[2] | escape }}" target="_blank">{{ euw[3] | escape }}</a></p>
      {%- for line in line_items -%}
        {%- assign euw_vm = line.variant.metafields[euw_ns].garan_image -%}
        {%- assign euw_img = euw_vm.value | default: euw_vm | append: '' -%}
        {%- if euw_img == '' -%}
          {%- assign euw_pm = line.product.metafields[euw_ns].garan_image -%}
          {%- assign euw_img = euw_pm.value | default: euw_pm | append: '' -%}
        {%- endif -%}
        {%- if euw_img != '' and euw_img != 'none' -%}
          <p style="margin:24px 0 8px;font-weight:bold">{{ line.title | escape }}{% if line.variant.title != blank and line.variant.title != 'Default Title' %} – {{ line.variant.title | escape }}{% endif %}</p>
          <a href="{{ euw_img | escape }}" target="_blank"><img src="{{ euw_img | escape }}" alt="GARAN – {{ euw[9] | escape }}" width="300" style="display:block;width:300px;max-width:100%;height:auto;border:0"></a>
          <p style="margin:8px 0 0;font-size:14px">{{ euw[8] | escape }}: <a href="{{ euw[10] | escape }}" target="_blank">{{ euw[11] | escape }}</a></p>
        {%- endif -%}
      {%- endfor -%}
    </td>
  </tr>
</table>
{%- endif -%}
`;
}
