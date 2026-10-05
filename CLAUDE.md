@AGENTS.md

# EU-Gewährleistungslabel – Shopify-App

## Ziel
Öffentliche Shopify-App (App Store), die auf Produktseiten anzeigt:
1. Harmonisierte Mitteilung zum gesetzlichen Gewährleistungsrecht (VO (EU) 2025/1960, Anhang I) – Pflicht ab 27.09.2026
2. GARAN-Label für Herstellergarantien > 2 Jahre (Anhang II)

Plan zur Feature-Parität mit der Konkurrenz (Phasen A–E): ~/.claude/plans/https-apps-shopify-com-garan-eu-guarante-serialized-ripple.md

## Struktur
- Projekt: ~/Shopify/eu-gewaehrleistungslabel (Shopify React-Router-Template + eigene Dateien)
- ~/Shopify/overlay: ursprüngliches Zusatzpaket (Referenz, nicht mehr bearbeiten)
- app/routes: app._index (Übersicht), app.settings, app.products._index, app.products.$id, app.export (CSV), webhooks.compliance, webhooks.app.subscriptions_update (nur Protokoll), webhooks.products.delete (GARAN-Zählung)
- app/lib: metafields.server.ts (gql mit Wiederholung bei THROTTLED), plan.server.ts, audit.server.ts
  - Tarifmodell: Mitteilung in jedem Tarif shopweit; Managed Pricing begrenzt nur Produkte mit GARAN-Label (Free 5 / Start 100 / Growth 500 / Scale unbegrenzt, Plan-Namen = Managed-Pricing-Namen). Zählung in Prisma GaranProduct.
  - Nach Downgrade wird nichts abgeschaltet (GARAN ist für den Händler Pflicht, wenn Herstellerangaben vorliegen); garanAllowed sperrt nur Neuanlage/Änderungen bis wieder im Limit.
  - garan.ts (Client + Server): Dauer parsen/formatieren, Breitenprüfung Marke/Modell/Dauer mit garan-geometry.json + inter-metrics.json
- app.export: gestreamt, Sichtbarkeitsregeln identisch zu blocks/eu-warranty.liquid halten; Abfragekosten < 1000 Punkte (PAGE_SIZE)
- Admin API 2026-10 (app/shopify.server.ts und [webhooks] api_version in shopify.app*.toml gemeinsam ändern); Scopes write_products,read_inventory (TOML + fly.toml SCOPES)
- shopify.app.toml = Dev-App, shopify.app.production.toml.example = Vorlage Prod-App
- extensions/eu-warranty-label (Theme-App-Extension, max. 100 KB Liquid – check-legal prüft):
  - blocks: eu-warranty (Produktseite), eu-warranty-cart (Warenkorb: Mitteilung + GARAN je Artikel), eu-warranty-embed (App-Embed, target body: Seitenwahl, Seitenende oder fixiertes Band; blendet sich aus, wenn ein Block auf der Seite liegt)
  - snippets: euw-rules (Sichtbarkeitsregeln, Ausgabe "show"/"used"), euw-notice (Mitteilung in allen Darstellungen), euw-garan (Varianten-Logik) -> garan-label (prüft Daten selbst), euw-modal, euw-zoom-hint, euw-lang
  - Snippets sehen globale Objekte (request, template, cart, shop), aber keine Variablen des Aufrufers; in render-Parametern keine Filter
  - snippets/euw-lang.liquid (GENERIERT): je Sprachfassung eine '§'-getrennte Zeile (Maße, Your-Europe-Links, amtlicher Titel/Text, Shop-Texte, Sprachcode); Sprache aus request.locale, Rückfall Englisch; Aufrufer greifen per Index zu (Index-Liste im Snippet)
  - assets/eu-warranty.js: Satz-Trigger, geschachteltes GARAN (<summary>) und Vergrößerungs-Modal (<dialog>, Link im Fuß), delegierte Listener
  - assets/eu-warranty-fonts.css (GENERIERT): Inter als Base64, nur geladen wenn GARAN sichtbar (eu-warranty.css muss < 100 KB bleiben, Theme Check)
- Varianten: gesetztes garan_confirmed an der Variante = eigene Angaben (false = kein Label), sonst wie Produkt; eu-warranty.js schaltet beim Variantenwechsel (Feld name="id" im Produktformular)
- Daten: app-eigener Namespace $app:eu_warranty (Händler nur lesen; Definitionen in ensureDefinitions, DEFINITIONS_VERSION; Liquid: shop/product.metafields['$app:eu_warranty']). Shop: settings JSON (b2bOnly, Ausschlüsse inkl. excludeCollectionIds); Produkt: exclude, used, garan_confirmed, garan_duration (Dezimal), garan_brand, garan_model
- Prisma/Postgres lokal via docker-compose; Deployment geplant: Fly.io (fra) + Neon (Frankfurt), siehe DEPLOY.md
- scripts/
  - fetch-eu-labels.mjs: `download` (offizielle Kommissionsdateien -> legal-sources/commission), `texts` (amtlicher Text aus PDFs, braucht pdftotext), `build` (Grafiken, euw-lang.liquid, Schrift, app/lib/garan-geometry.json + inter-metrics.json)
  - i18n/storefront.json (Shop-Texte 24 Sprachen, Quelle für euw-lang), i18n/notice-text.json (generiert)
  - check-legal.mjs (Release-Check, muss grün sein), liquid-engine.mjs (liquidjs mit Shopify-Nachbildungen), preview-block.mjs (Block-Vorschau; .claude/launch.json "block-preview")
- tests/: `npm test` (vite-node): garan (Breiten/Dauer), block (Liquid-Regeln), plan-export (braucht lokale Postgres aus docker-compose und .env)

## Rechtliche Vorgaben (nicht verletzen) – Quelle: VO (EU) 2025/1960 + Praxisleitlinien der Kommission (Ares(2026)4331985, April 2026)
- Nur die offiziellen Dateien der Kommission verwenden (RGB, farbig online). Mitteilung: offizielle PNGs (randloses Design ohne äußere Rahmenlinie), nur leerer Seitenbereich darunter entfernt; Englisch aus offiziellem SVG gerastert (fehlt im PNG-Archiv).
- Mitteilung Anhang I: KEIN Element editierbar, nicht beschneiden/verzerren. Online zulässig: vollständig ODER eingeklappt als Satz zu den Gewährleistungsrechten (z. B. „Your legal guarantee rights“), Mitteilung erscheint beim ersten Klick (Leitlinien 2.3).
- Lesbar bei Standardgröße (2.3): Fließtext der Grafik ≈ 2,6 % ihrer Breite (BG 2,4 %, gemessen in den PDFs) → inline erst ab 500 px Breite (≥ 12 px). Darstellungen: „collapsed“ (Standard, <details>: klappt ab 500 px Platz inline auf, schmaler öffnet derselbe Klick das Modal), „auto“ (vollständig ab 500 px Container, sonst Satz → Modal), „full“. Breitenregler min. 500 px. 500 steht in eu-warranty.js (INLINE_MIN_WIDTH) und eu-warranty.css (@container) – gemeinsam ändern.
- Klickbarer Link zum Ziel des QR-Codes muss immer verfügbar sein (Mitteilung: 24 URLs aus Leitlinien 2.3; GARAN: europa.eu/youreurope/commercial-guarantee-durability) – auch im Modal.
- GARAN Anhang II: editierbar nur Dauer (XX), Marke, Modellkennung; Schrift Inter, Größe/Position wie offizielle SVG-Vorlage, nie verkleinern/umbrechen → Breitenprüfung statt Zeichenzahl. Dauer rechtsbündig mit demselben Konturabstand zum Kalendersymbol wie „XX“ (2,5 Einheiten; Anker je letzter Ziffer in garan-geometry.json years.anchors, wie im Beispiel der Kommission). Online farbig. Geschachteltes Format erlaubt; volles Label „after mouseover or click“ (Leitlinien 3.3), beim ersten Klick vollständig (3.3.1). Umsetzung: <details>/<summary>, erster Klick/Tipp/Enter öffnet das volle Label im Modal, kein Hover; ohne Skript klappt <details> inline auf.
- GARAN nur bei bestätigter Garantie (garan_confirmed) des Herstellers für die gesamte Ware, ohne Zusatzkosten, > 2 Jahre. Dauer ganze Jahre oder ,5 mit Komma (Leitlinien 3.1 vi). Kleinere Nachkommastelle NICHT verwenden, solange keine Quelle vorliegt (ALLOW_SMALLER_DECIMALS in app/lib/garan.ts) → ,5-Werte passen in voller Größe nicht und werden abgelehnt.
- Hinweise/Icons nur unter, nie auf amtlichen Grafiken; Modal ist nur Zusatz.
- Keine unbelegten Aussagen über Kommissions-Auskünfte in App-Texte übernehmen (z. B. Angaben aus Konkurrenz-Doku erst an Primärquelle prüfen).
