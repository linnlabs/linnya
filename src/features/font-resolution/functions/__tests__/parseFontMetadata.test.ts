import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseFontFileMetadata,
  parseFontMetadata,
  readFontFileMetadata,
} from '../parseFontMetadata.js';

const SINGLE_FACE_FONT_CANDIDATES = [
  '/System/Library/Fonts/Symbol.ttf',
  '/System/Library/Fonts/SFNS.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Georgia.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
] as const;

const COLLECTION_FONT_CANDIDATES = [
  '/System/Library/Fonts/Menlo.ttc',
  '/System/Library/Fonts/HelveticaNeue.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
] as const;

describe('parseFontMetadata', () => {
  const singleFaceFontPath = findExistingFile(SINGLE_FACE_FONT_CANDIDATES);

  if (singleFaceFontPath == null) {
    it.skip('解析单 face 字体文件的 Office-like 排版元数据');
  } else {
    it('解析单 face 字体文件的 Office-like 排版元数据，目录异步读取保留相同身份', async () => {
      const metadata = parseFontMetadata(singleFaceFontPath);
      expect(await readFontFileMetadata(singleFaceFontPath)).toEqual(parseFontFileMetadata(singleFaceFontPath));

      expect(metadata).not.toBeNull();
      if (metadata == null) {
        return;
      }
      expect(metadata.family.length).toBeGreaterThan(0);
      expect(metadata.subfamily.length).toBeGreaterThan(0);
      expect(metadata.postscriptName.length).toBeGreaterThan(0);
      expect(metadata.faceIndex).toBe(0);
      expect(metadata.faceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(metadata.panose).toHaveLength(10);
      expect(metadata.unicodeRanges).toHaveLength(4);
      expect(metadata.glyphCodePointRanges.length).toBeGreaterThan(0);
      expect(metadata.avgCharWidth).toBeGreaterThan(0);
      expect(metadata.avgCharWidth).toBeLessThan(2);
      expect(metadata.winAscent).toBeGreaterThan(0);
      expect(metadata.winDescent).toBeGreaterThanOrEqual(0);
    });
  }

  const collectionFontPath = findExistingFile(COLLECTION_FONT_CANDIDATES);

  if (collectionFontPath == null) {
    it.skip('把 .ttc collection 枚举为多个 font face');
  } else {
    it('同步和异步读取 .ttc collection 均保留全部 face 及相同指纹', async () => {
      const metadataList = parseFontFileMetadata(collectionFontPath);
      expect(await readFontFileMetadata(collectionFontPath)).toEqual(metadataList);

      expect(metadataList.length).toBeGreaterThan(1);
      metadataList.forEach((metadata, faceIndex) => {
        expect(metadata.filePath).toBe(collectionFontPath);
        expect(metadata.faceIndex).toBe(faceIndex);
        expect(metadata.postscriptName.length).toBeGreaterThan(0);
        expect(metadata.faceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        expect(metadata.panose).toHaveLength(10);
        expect(metadata.glyphCodePointRanges.length).toBeGreaterThan(0);
      });

      const firstFace = metadataList[0];
      expect(firstFace).toBeDefined();
      if (firstFace == null) {
        return;
      }

      const namedFace = parseFontMetadata(collectionFontPath, {
        postscriptName: firstFace.postscriptName,
      });
      expect(namedFace?.postscriptName).toBe(firstFace.postscriptName);
      expect(namedFace?.faceFingerprint).toBe(firstFace.faceFingerprint);
    });
  }

  it('损坏、不支持或无法读取的外部字体文件返回 null/空列表', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linnya-font-resolution-'));
    const corruptFontPath = join(dir, 'corrupt.ttf');
    writeFileSync(corruptFontPath, 'not a font');

    expect(parseFontMetadata(corruptFontPath)).toBeNull();
    expect(parseFontFileMetadata(corruptFontPath)).toEqual([]);
    expect(await readFontFileMetadata(corruptFontPath)).toEqual([]);
    expect(await readFontFileMetadata(join(dir, 'missing.ttf'))).toEqual([]);
  });
});

function findExistingFile(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
