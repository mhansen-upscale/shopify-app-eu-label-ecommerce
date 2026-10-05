// fontkit 2 liefert keine Typen; nur der Teil, den app/lib/render.server.ts nutzt
declare module "fontkit" {
  export interface Glyph {
    advanceWidth: number;
    path: { toSVG(): string };
  }
  export interface Font {
    unitsPerEm: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): Glyph;
  }
  export function create(buffer: Buffer): Font;
}
