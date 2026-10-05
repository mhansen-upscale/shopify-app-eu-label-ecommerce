-- Die Mitteilung gilt jetzt in jedem Tarif shopweit; die Tabelle zählt stattdessen Produkte mit GARAN-Label (Tariflimit).
ALTER TABLE "ActiveProduct" RENAME TO "GaranProduct";
ALTER TABLE "GaranProduct" RENAME CONSTRAINT "ActiveProduct_pkey" TO "GaranProduct_pkey";
-- Bisherige Einträge waren Produktauswahlen für die Mitteilung, keine GARAN-Produkte
DELETE FROM "GaranProduct";
