import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openSync } from 'fontkit';
import type { FontKitCollection, FontKitFont } from 'fontkit';
import type { FontMetadata } from '../definitions/types.js';
import { compressGlyphCodePointRanges } from './glyphCoverage.js';

interface ParseFontMetadataOptions {
  postscriptName?: string;
}

type FontKitOpenResult = FontKitFont | FontKitCollection;

export function parseFontMetadata(filePath: string, options: ParseFontMetadataOptions = {}): FontMetadata | null {
  try {
    const fileFingerprint = hashFontFile(filePath);
    const opened = openSync(filePath, options.postscriptName);
    if (isFontCollection(opened)) {
      return null;
    }

    return buildMetadata(filePath, opened, 0, fileFingerprint);
  } catch {
    // 字体文件来自系统目录或用户机器，损坏/不支持时跳过该文件，避免扫描流程被外部输入打断。
    return null;
  }
}

export function parseFontFileMetadata(filePath: string): readonly FontMetadata[] {
  try {
    const fileFingerprint = hashFontFile(filePath);
    const opened = openSync(filePath);
    if (!isFontCollection(opened)) {
      const metadata = buildMetadata(filePath, opened, 0, fileFingerprint);
      return metadata == null ? [] : [metadata];
    }

    const metadataList: FontMetadata[] = [];
    for (const [faceIndex, font] of opened.fonts.entries()) {
      const metadata = buildMetadata(filePath, font, faceIndex, fileFingerprint);
      if (metadata != null) {
        metadataList.push(metadata);
      }
    }
    return metadataList;
  } catch {
    // 同 parseFontMetadata：系统字体目录是外部边界，坏文件不应中断整个 catalog 扫描。
    return [];
  }
}

function isFontCollection(opened: FontKitOpenResult): opened is FontKitCollection {
  return 'fonts' in opened && opened.type === 'TTC';
}

function buildMetadata(
  filePath: string,
  font: FontKitFont,
  faceIndex: number,
  fileFingerprint: string,
): FontMetadata | null {
  const os2 = font['OS/2'];
  if (os2 == null || !hasRequiredVerticalMetrics(os2) || font.unitsPerEm <= 0) {
    return null;
  }

  const unicodeRanges = toNumberTuple4(os2.ulCharRange);
  if (unicodeRanges == null || os2.panose.length !== 10) {
    return null;
  }

  return {
    family: font.familyName,
    subfamily: font.subfamilyName,
    postscriptName: font.postscriptName,
    filePath,
    faceIndex,
    faceFingerprint: createFaceFingerprint(fileFingerprint, faceIndex, font.postscriptName),
    panose: [...os2.panose],
    unicodeRanges,
    glyphCodePointRanges: compressGlyphCodePointRanges(font.characterSet),
    codePageRanges: toOptionalNumberTuple2(os2.codePageRange),
    isFixedPitch: font.post?.isFixedPitch === 1,
    avgCharWidth: normalizeMetric(os2.xAvgCharWidth, font.unitsPerEm),
    xHeight: normalizeOptionalMetric(os2.xHeight, font.unitsPerEm),
    capHeight: normalizeOptionalMetric(os2.capHeight, font.unitsPerEm),
    winAscent: normalizeMetric(os2.winAscent, font.unitsPerEm),
    winDescent: normalizeMetric(os2.winDescent, font.unitsPerEm),
    typoAscent: normalizeMetric(os2.typoAscender, font.unitsPerEm),
    typoDescent: normalizeMetric(os2.typoDescender, font.unitsPerEm),
    typoLineGap: normalizeMetric(os2.typoLineGap, font.unitsPerEm),
    useTypoMetrics: os2.fsSelection.useTypoMetrics,
    bold: os2.fsSelection.bold,
    italic: os2.fsSelection.italic || os2.fsSelection.oblique,
  };
}

function hashFontFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createFaceFingerprint(
  fileFingerprint: string,
  faceIndex: number,
  postscriptName: string,
): string {
  return createHash('sha256')
    .update(fileFingerprint)
    .update('\0')
    .update(String(faceIndex))
    .update('\0')
    .update(postscriptName)
    .digest('hex');
}

function hasRequiredVerticalMetrics(os2: FontKitFont['OS/2']): os2 is NonNullable<FontKitFont['OS/2']> & {
  typoAscender: number;
  typoDescender: number;
  typoLineGap: number;
  winAscent: number;
  winDescent: number;
} {
  return (
    os2 != null
    && os2.typoAscender != null
    && os2.typoDescender != null
    && os2.typoLineGap != null
    && os2.winAscent != null
    && os2.winDescent != null
  );
}

function normalizeMetric(value: number, unitsPerEm: number): number {
  return value / unitsPerEm;
}

function normalizeOptionalMetric(value: number | undefined, unitsPerEm: number): number | undefined {
  return value == null ? undefined : normalizeMetric(value, unitsPerEm);
}

function toNumberTuple4(values: readonly number[]): readonly [number, number, number, number] | null {
  if (values.length !== 4) {
    return null;
  }
  const [first, second, third, fourth] = values;
  if (first == null || second == null || third == null || fourth == null) {
    return null;
  }
  return [first, second, third, fourth];
}

function toOptionalNumberTuple2(values: readonly number[] | undefined): readonly [number, number] | undefined {
  if (values == null || values.length !== 2) {
    return undefined;
  }
  const [first, second] = values;
  if (first == null || second == null) {
    return undefined;
  }
  return [first, second];
}
