declare module 'fontkit' {
  export interface FontKitSelectionFlags {
    italic: boolean;
    underscore: boolean;
    negative: boolean;
    outlined: boolean;
    strikeout: boolean;
    bold: boolean;
    regular: boolean;
    useTypoMetrics: boolean;
    wws: boolean;
    oblique: boolean;
  }

  export interface FontKitOS2Table {
    version: number;
    xAvgCharWidth: number;
    usWeightClass: number;
    panose: readonly number[];
    ulCharRange: readonly number[];
    fsSelection: FontKitSelectionFlags;
    typoAscender?: number;
    typoDescender?: number;
    typoLineGap?: number;
    winAscent?: number;
    winDescent?: number;
    codePageRange?: readonly number[];
    xHeight?: number;
    capHeight?: number;
  }

  export interface FontKitPostTable {
    isFixedPitch: number;
  }

  export interface FontKitBBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  /** 字形轮廓；scale/translate 返回新路径，不改原路径。 */
  export interface FontKitPath {
    bbox: FontKitBBox;
    scale(scaleX: number, scaleY?: number): FontKitPath;
    translate(x: number, y: number): FontKitPath;
    toSVG(): string;
  }

  export interface FontKitGlyph {
    advanceWidth: number;
    path: FontKitPath;
  }

  export interface FontKitGlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }

  export interface FontKitGlyphRun {
    glyphs: readonly FontKitGlyph[];
    positions: readonly FontKitGlyphPosition[];
  }

  export interface FontKitFont {
    familyName: string;
    subfamilyName: string;
    postscriptName: string;
    unitsPerEm: number;
    post?: FontKitPostTable;
    'OS/2'?: FontKitOS2Table;
    characterSet: readonly number[];
    glyphForCodePoint(codePoint: number): FontKitGlyph;
    fullName: string;
    ascent: number;
    descent: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    /** OpenType 特性按四字母标签传，例如竖排用 `['vert']`。 */
    layout(text: string, features?: readonly string[]): FontKitGlyphRun;
    /** name 表记录，例如 `license`、`licenseURL`；没有时为 null。 */
    getName(key: string, lang?: string): string | null;
  }

  export interface FontKitCollection {
    type: 'TTC';
    fonts: readonly FontKitFont[];
    getFont(postscriptName: string): FontKitFont | null;
  }

  export function create(buffer: Buffer, postscriptName?: string): FontKitFont | FontKitCollection;
  export function openSync(filePath: string, postscriptName?: string): FontKitFont | FontKitCollection;
  export function open(filePath: string, postscriptName?: string): Promise<FontKitFont | FontKitCollection>;
}
