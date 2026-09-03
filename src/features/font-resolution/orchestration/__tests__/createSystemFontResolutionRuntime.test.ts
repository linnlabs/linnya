import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FontMetadata } from '../../definitions/types.js';
import { FontCatalog } from '../FontCatalog.js';
import { resolveFont } from '../defaultFontResolutionService.js';
import { createSystemFontResolutionRuntimeFromCatalog } from '../createSystemFontResolutionRuntime.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SystemFontResolutionRuntime', () => {
  it('让 standalone 查询与默认字体解析消费同一份已就绪目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'linnya-system-font-runtime-'));
    temporaryRoots.push(root);
    const fontRoot = join(root, 'fonts');
    mkdirSync(fontRoot, { recursive: true });
    const fontPath = join(fontRoot, 'AuditSans.ttf');
    writeFileSync(fontPath, 'font fixture identity');
    const metadata = makeFontMetadata(fontPath);
    const catalog = new FontCatalog({
      scanRoots: [fontRoot],
      cacheFilePath: join(root, 'cache', 'font-catalog.json'),
      parseFontFileMetadata: () => [metadata],
    });
    const runtime = createSystemFontResolutionRuntimeFromCatalog(catalog);

    try {
      expect(resolveFont({
        family: 'Audit Sans',
        bold: false,
        italic: false,
        script: 'latin',
      }).resolution).toBe('not-ready');

      await runtime.initialize();

      await expect(runtime.checkFontFamily('Audit Sans')).resolves.toMatchObject({
        installed: true,
        match: { family: 'Audit Sans' },
      });
      expect(resolveFont({
        family: 'Audit Sans',
        bold: false,
        italic: false,
        script: 'latin',
      })).toMatchObject({
        resolution: 'exact',
        catalogReady: true,
        resolvedFamily: 'Audit Sans',
        resolved: { filePath: fontPath },
      });
    } finally {
      runtime.dispose();
    }

    expect(resolveFont({
      family: 'Audit Sans',
      bold: false,
      italic: false,
      script: 'latin',
    }).resolution).toBe('not-ready');
  });
});

function makeFontMetadata(filePath: string): FontMetadata {
  return {
    family: 'Audit Sans',
    subfamily: 'Regular',
    postscriptName: 'AuditSans-Regular',
    filePath,
    faceIndex: 0,
    faceFingerprint: 'audit-font-fingerprint',
    panose: [2, 11, 5, 3, 2, 2, 3, 2, 2, 4],
    unicodeRanges: [1, 0, 0, 0],
    glyphCodePointRanges: [[0, 0x10FFFF]],
    isFixedPitch: false,
    avgCharWidth: 0.5,
    winAscent: 0.8,
    winDescent: 0.2,
    typoAscent: 0.75,
    typoDescent: -0.25,
    typoLineGap: 0,
    useTypoMetrics: true,
    bold: false,
    italic: false,
  };
}
