import assert from "node:assert/strict";
import { measure, parseDuration, formatDuration, validateGaran } from "../app/lib/garan";
import geometry from "../app/lib/garan-geometry.json";

const ok: string[] = [];
const t = (name: string, fn: () => void) => { fn(); ok.push("✓ " + name); };
const v = (duration: string, brand = "Bosch", model = "GSR 18V-55") => validateGaran({ duration, brand, model });

t("XX in der Vorlage: gemessene Breite = Abstand Start bis Anker", () => {
  const w = measure("XX", "extrabold", 80, -0.03)!;
  assert.ok(Math.abs(5.07 + w - geometry.full.years.xEnd) < 0.01, String(w));
});
t("Dauer parsen/formatieren", () => {
  assert.equal(parseDuration("5"), 5); assert.equal(parseDuration("2,5"), 2.5); assert.equal(parseDuration(" 4.5 "), 4.5);
  assert.ok(Number.isNaN(parseDuration("5 Jahre"))); assert.ok(Number.isNaN(parseDuration("")));
  assert.equal(formatDuration(5), "5"); assert.equal(formatDuration(2.5), "2,5");
});
t("Gültig: 3, 5, 10, 99 Jahre", () => { for (const d of ["3", "5", "10", "99"]) assert.deepEqual(v(d).errors, {}, d); });
t("Abgelehnt: 2 und weniger", () => { assert.match(v("2").errors.duration!, /über 2 Jahre/); assert.match(v("1").errors.duration!, /über 2 Jahre/); });
t("Abgelehnt: andere Dezimalstellen als ,5", () => { assert.match(v("3,3").errors.duration!, /ganze oder halbe/); });
t("Abgelehnt: ,5 passt in voller Größe nicht (keine verkleinerte Nachkommastelle)", () => {
  for (const d of ["2,5", "4,5", "10,5"]) assert.match(v(d).errors.duration!, /passt in voller Schriftgröße nicht/, d);
});
t("Marke/Modell: Pflicht und nur Zeichen aus der eingebetteten Inter", () => {
  assert.match(validateGaran({ duration: "5", brand: "", model: "X" }).errors.brand!, /fehlt/);
  assert.match(validateGaran({ duration: "5", brand: "東芝", model: "X1" }).errors.brand!, /Nicht darstellbar.*東/);
  assert.deepEqual(validateGaran({ duration: "5", brand: "Škoda Ελλάδα Россия", model: "Ž-1" }).errors, {});
});
t("Marke + Modell zu breit -> Fehler mit Hinweis, bis wohin es passt", () => {
  const e = validateGaran({ duration: "5", brand: "Bosch Professional Power Tools", model: "GSR 18V-55 Brushless Professional Edition XL" }).errors;
  assert.match(e.model!, /zusammen zu breit/); assert.match(e.model!, /Passt bis „GSR/);
});
t("Breite statt Zeichenzahl: 16 schmale Zeichen passen, 16 breite nicht", () => {
  assert.deepEqual(validateGaran({ duration: "5", brand: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii", model: "lllllllllllllllllllllll" }).errors, {});
  assert.ok(validateGaran({ duration: "5", brand: "WWWWWWWWWWWWWWWWWWWWW", model: "MMMMMMMMMMMMMMMMMMMM" }).errors.model);
});
console.log(ok.join("\n")); console.log(ok.length + " Tests bestanden");
