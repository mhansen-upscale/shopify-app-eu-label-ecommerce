/**
 * GARAN-Angaben prüfen (Anhang II VO (EU) 2025/1960, Praxisleitlinien der Kommission April 2026).
 * Läuft im Admin-Formular (Live-Hinweis) und auf dem Server (Speichern, Import) mit denselben Daten:
 * Geometrie aus der offiziellen SVG-Vorlage, Laufweiten aus derselben Inter-Schrift, die der Shop einbettet.
 * Beides erzeugt `node scripts/fetch-eu-labels.mjs build`.
 */
import geometry from "./garan-geometry.json";
import metrics from "./inter-metrics.json";

type Style = "regular" | "extrabold";
const advances = metrics as unknown as { unitsPerEm: number } & Record<Style, Record<string, number>>;

/**
 * Halbe Jahre erlauben die Leitlinien (3.1 vi). Die Kommission soll eine kleinere Nachkommastelle zugelassen haben;
 * solange die Quelle dafür nicht vorliegt, wird die Dauer in voller Größe gesetzt und muss ins Feld passen.
 */
export const ALLOW_SMALLER_DECIMALS = false;

/** Breite eines Textes in Einheiten der SVG-Vorlage; null, wenn ein Zeichen nicht in der eingebetteten Inter liegt. */
export function measure(text: string, style: Style, size: number, letterSpacing = 0): number | null {
  let units = 0;
  const chars = [...text];
  for (const ch of chars) {
    const adv = advances[style][String(ch.codePointAt(0))];
    if (adv === undefined) return null;
    units += adv;
  }
  return (units / advances.unitsPerEm) * size + letterSpacing * size * chars.length;
}

/** "3", "2,5", "2.5" -> Zahl; alles andere -> NaN. */
export function parseDuration(input: string): number {
  const s = input.trim().replace(",", ".");
  return /^\d{1,2}(\.\d)?$/.test(s) ? Number(s) : NaN;
}

/** Schreibweise auf dem Label: ganze Jahre ohne, halbe Jahre mit Komma (in jeder Sprache, Leitlinien 3.1 vi). */
export function formatDuration(years: number): string {
  return Number.isInteger(years) ? String(years) : String(years).replace(".", ",");
}

/** Zeichen, die nicht in der eingebetteten Inter liegen (würden in einer Ersatzschrift erscheinen). */
function unsupportedChars(text: string) {
  return [...new Set([...text].filter((ch) => advances.regular[String(ch.codePointAt(0))] === undefined))];
}

/** Bis zu welchem Zeichen passt ein Text in die verfügbare Breite? */
function fitsUpTo(text: string, maxWidth: number) {
  const chars = [...text];
  let n = chars.length;
  while (n > 0 && (measure(chars.slice(0, n).join(""), "regular", geometry.full.brand.size) ?? Infinity) > maxWidth) n--;
  return n;
}

export type GaranInput = { duration: string; brand: string; model: string };
export type GaranErrors = Partial<Record<keyof GaranInput, string>>;

export function validateGaran(input: GaranInput): { errors: GaranErrors; years: number | null } {
  const errors: GaranErrors = {};
  const brand = input.brand.trim();
  const model = input.model.trim();
  const years = parseDuration(input.duration);

  if (Number.isNaN(years)) errors.duration = "Bitte die Dauer in ganzen oder halben Jahren angeben, z. B. 5 oder 2,5.";
  else if (years <= 2) errors.duration = "Das GARAN-Label gilt nur für Herstellergarantien über 2 Jahre.";
  else if ((years * 2) % 1 !== 0) errors.duration = "Nur ganze oder halbe Jahre sind zulässig (z. B. 3 oder 4,5).";
  else {
    const label = formatDuration(years);
    for (const variant of ["full", "nested"] as const) {
      const y = geometry[variant].years;
      const width = measure(label, "extrabold", y.size, y.letterSpacing) ?? Infinity;
      const anchor = y.anchors[label.slice(-1) as keyof typeof y.anchors]; // wie snippets/garan-label.liquid
      if (anchor - width < y.minX && !(ALLOW_SMALLER_DECIMALS && !Number.isInteger(years))) {
        errors.duration = Number.isInteger(years)
          ? "Diese Dauer passt nicht ins Label."
          : `„${label}“ passt in voller Schriftgröße nicht vor das Kalendersymbol des Labels. Die Vorgaben erlauben keine kleinere Schrift; bitte ganze Jahre angeben.`;
        break;
      }
    }
  }

  const { brand: b, model: m, minGap } = geometry.full;
  const lineWidth = m.xEnd - b.x;
  for (const [key, value, label] of [["brand", brand, "Marke"], ["model", model, "Modellkennung"]] as const) {
    if (!value) { errors[key] = `${label} fehlt.`; continue; }
    const bad = unsupportedChars(value);
    if (bad.length) errors[key] = `Nicht darstellbar in der Etikettenschrift Inter: ${bad.join(" ")}`;
  }
  if (!errors.brand && !errors.model) {
    const wb = measure(brand, "regular", b.size)!;
    const wm = measure(model, "regular", m.size)!;
    if (wb + minGap + wm > lineWidth) {
      // Marke und Modellkennung teilen sich eine Zeile; Schrift verkleinern oder umbrechen ist nicht erlaubt
      const room = lineWidth - minGap;
      const hint = (text: string, other: number) => {
        const n = fitsUpTo(text, room - other);
        return n > 0 ? ` Passt bis „${[...text].slice(0, n).join("")}“.` : "";
      };
      errors.model = `Marke und Modellkennung sind zusammen zu breit für das Label (die Schrift darf nicht verkleinert oder umbrochen werden).${hint(model, wb)}`;
    }
  }
  return { errors, years: errors.duration ? null : years };
}
