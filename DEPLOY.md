# Server & Deployment

## Zielbild

```
Händler-Admin ──> Shopify Admin (eingebettet) ──> Fly.io, Frankfurt ──> Neon Postgres, Frankfurt
                                                   (Admin-App, OAuth,       (Sessions, Limits,
                                                    Webhooks, Export)        Protokoll)
Storefront ──> Theme-Block (bei Shopify gehostet) ──> Metafields   ← kein Kontakt zu deinem Server
```

Kosten grob: Fly eine kleine Maschine (512 MB) plus Neon Free- oder Launch-Tarif. Beide Anbieter haben Regionen in Frankfurt, damit bleiben alle Daten in der EU.

## 1. Zwei Apps im Partner Dashboard

Lege eine **Dev-App** und eine **Produktions-App** an. `shopify app dev` überschreibt bei der Dev-App ständig die URLs mit der Tunnel-Adresse; das darf der echten App nie passieren.

```bash
shopify app config link          # Dev-App  -> shopify.app.toml
shopify app config link          # Prod-App -> shopify.app.production.toml (Vorlage: *.example)
```

## 2. Datenbank auf Postgres umstellen

SQLite-Migrationen laufen nicht auf Postgres, deshalb einmal neu erzeugen:

```bash
# datasource-Block in prisma/schema.prisma durch prisma/datasource.postgres.prisma ersetzen
docker compose up -d             # lokale Postgres
cp .env.example .env
rm -rf prisma/migrations
npx prisma migrate dev --name init
```

Ab jetzt entwickelst du lokal gegen Postgres, genau wie in Produktion.

## 3. Neon-Datenbank anlegen

Auf neon.tech ein Projekt in **AWS Europe Central 1 (Frankfurt)** erstellen und beide Connection-Strings kopieren: den gepoolten (`DATABASE_URL`) und den direkten (`DIRECT_URL`, für Migrationen).

## 4. Fly.io einrichten

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --copy-config      # übernimmt fly.toml, App-Name ggf. ändern

fly secrets set \
  SHOPIFY_API_KEY="<Client-ID Prod-App>" \
  SHOPIFY_API_SECRET="<Client-Secret Prod-App>" \
  DATABASE_URL="<Neon pooled>" \
  DIRECT_URL="<Neon direct>" \
  APP_HANDLE="eu-gewaehrleistungslabel"

fly deploy
curl https://eu-gewaehrleistungslabel.fly.dev/healthz    # -> ok
```

Ändert sich der App-Name, passe `SHOPIFY_APP_URL` in `fly.toml` und alle URLs in `shopify.app.production.toml` an.

## 5. Shopify-Seite deployen

```bash
shopify app deploy --config production
```

Das überträgt URLs, Scopes, Webhooks **und die Theme-Extension** an Shopify. Wiederholen, sobald sich etwas in `extensions/` oder der TOML ändert. Code-Änderungen am Admin gehen dagegen nur über `fly deploy`.

## 6. Testen

1. Entwicklungs-Shop anlegen, Prod-App über den Installationslink aus dem Partner Dashboard installieren.
2. Einstellungen speichern, Block im Theme-Editor einfügen, Produktseite öffnen.
3. `shopify app webhook trigger --topic shop/redact --address https://eu-gewaehrleistungslabel.fly.dev/webhooks/compliance` für den DSGVO-Webhook.
4. App deinstallieren und neu installieren; Sessions müssen sauber neu angelegt werden.
5. `fly logs` beobachten.

## 7. Automatisch deployen (optional)

`.github/workflows/deploy.yml` deployt bei jedem Push auf `main`. Vorher prüft der Workflow mit `check-legal.mjs`, ob alle amtlichen Label-Vorlagen vorhanden sind. Im Repo das Secret `FLY_API_TOKEN` hinterlegen (`fly tokens create deploy`). Die Theme-Extension deployst du weiterhin bewusst von Hand (Schritt 5).

## Betrieb

- **Kein Kaltstart:** `min_machines_running = 1` und `auto_stop_machines = "off"`, weil Shopify Webhooks nach 5 Sekunden als fehlgeschlagen wertet.
- **Backups:** Neon bietet Point-in-Time-Restore; im Free-Tarif ist das Zeitfenster kurz, für den Live-Betrieb lohnt der kleinste bezahlte Tarif.
- **Skalierung:** `fly scale count 2` für Ausfallsicherheit; Migrationen laufen trotzdem nur einmal (`release_command`).
- **Fehler-Monitoring:** Für den Start reicht `fly logs`; später z. B. Sentry mit EU-Datenregion.
- **Datenschutz:** Fly.io und Neon als Auftragsverarbeiter in deiner Datenschutzerklärung nennen und jeweils den AV-Vertrag abschließen.
