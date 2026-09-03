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

  export interface FontKitGlyph {
    advanceWidth: number;
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
  }

  export interface FontKitCollection {
    type: 'TTC';
    fonts: readonly FontKitFont[];
    getFont(postscriptName: string): FontKitFont | null;
  }

  export function openSync(filePath: string, postscriptName?: string): FontKitFont | FontKitCollection;
}
