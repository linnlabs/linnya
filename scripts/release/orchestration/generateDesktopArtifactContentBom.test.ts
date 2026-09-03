import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPackage } from '@electron/asar';
import { describe, expect, it } from 'vitest';

import { createDesktopArtifactContentBom } from './generateDesktopArtifactContentBom';

describe('Desktop artifact content BOM', () => {
  it('同时盘点 app filesystem、app.asar 与最终发行包', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-desktop-content-bom-'));
    try {
      const appRoot = path.join(tempRoot, 'win-unpacked');
      const asarSource = path.join(tempRoot, 'asar-source');
      fs.mkdirSync(path.join(appRoot, 'resources'), { recursive: true });
      fs.mkdirSync(path.join(asarSource, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(asarSource, 'node_modules', 'example'), { recursive: true });
      fs.writeFileSync(path.join(appRoot, 'Linnya.exe'), 'desktop');
      fs.writeFileSync(path.join(asarSource, 'dist', 'main.cjs'), 'main');
      fs.writeFileSync(path.join(asarSource, 'node_modules', 'example', 'index.js'), 'dependency');
      await createPackage(asarSource, path.join(appRoot, 'resources', 'app.asar'));

      const installerPath = path.join(tempRoot, 'Linnya-1.0.0-win.exe');
      const blockmapPath = `${installerPath}.blockmap`;
      const latestPath = path.join(tempRoot, 'latest.yml');
      fs.writeFileSync(installerPath, 'installer');
      fs.writeFileSync(blockmapPath, 'blockmap');
      fs.writeFileSync(latestPath, 'latest');

      const bom = await createDesktopArtifactContentBom({
        appRoot,
        artifactPaths: [
          { filePath: installerPath, role: 'desktop-installer' },
          { filePath: blockmapPath, role: 'release-blockmap' },
          { filePath: latestPath, role: 'release-metadata' },
        ],
        identity: {
          name: 'Linnya',
          version: '1.0.0',
          platform: 'win32',
          architecture: 'x64',
        },
        source: { revision: 'c'.repeat(40), dirty: false },
        environment: {
          nodeVersion: 'v22.23.1',
          electronVersion: '43.4.0',
          platform: 'darwin',
          architecture: 'arm64',
        },
      });

      expect(bom.artifacts.map(artifact => artifact.fileName)).toEqual([
        'latest.yml',
        'Linnya-1.0.0-win.exe',
        'Linnya-1.0.0-win.exe.blockmap',
      ]);
      expect(
        bom.entries.find(entry => entry.scope === 'app-asar' && entry.path === 'dist/main.cjs')
      ).toMatchObject({ category: 'application-code', type: 'file' });
      expect(
        bom.entries.find(
          entry => entry.scope === 'app-asar' && entry.path === 'node_modules/example/index.js'
        )
      ).toMatchObject({ category: 'production-dependency', type: 'file' });
      expect(JSON.stringify(bom)).not.toContain(tempRoot);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
