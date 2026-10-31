import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { createPackage } from '@electron/asar';
import { describe, expect, it } from 'vitest';

import { createDesktopArtifactContentBom } from './generateDesktopArtifactContentBom';
import { generateDesktopArtifactPackageMap } from './generateDesktopArtifactPackageMap';

describe('Desktop artifact content BOM', () => {
  it('同时盘点 app filesystem、app.asar 与最终发行包', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-desktop-content-bom-'));
    try {
      const outputRoot = path.join(tempRoot, 'dist_build', 'dist_electron');
      const appRoot = path.join(outputRoot, 'win-unpacked');
      const asarSource = path.join(tempRoot, 'asar-source');
      const productionLock = JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/example': { version: '1.0.0', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity: 'sha512-example' } },
      });
      fs.mkdirSync(path.join(appRoot, 'resources'), { recursive: true });
      fs.mkdirSync(path.join(asarSource, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(asarSource, 'node_modules', 'example'), { recursive: true });
      fs.writeFileSync(path.join(appRoot, 'Linnya.exe'), 'desktop');
      fs.writeFileSync(path.join(asarSource, 'dist', 'main.cjs'), 'main');
      fs.writeFileSync(path.join(asarSource, 'node_modules', 'example', 'index.js'), 'dependency');
      fs.writeFileSync(path.join(asarSource, 'node_modules', 'example', 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }));
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
          nodeVersion: 'v24.18.0',
          electronVersion: '43.4.0',
          platform: 'darwin',
          architecture: 'arm64',
          productionPackageLockSha256: createHash('sha256').update(productionLock).digest('hex'),
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

      // 从真实 ASAR 继续生成 package map，覆盖 Windows 原生查询路径与中立 BOM 路径的转换。
      fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({
        version: '1.0.0', build: { productName: 'Linnya', publish: { url: 'https://example.com' } },
      }));
      fs.writeFileSync(path.join(tempRoot, 'production-package-lock.json'), productionLock);
      fs.writeFileSync(path.join(outputRoot, 'linnya-desktop-1.0.0.win32-x64.content-bom.json'), JSON.stringify(bom));
      const mapPath = generateDesktopArtifactPackageMap({ rootDir: tempRoot, architecture: 'x64', platform: 'win32', verify: false });
      const map: unknown = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      expect(map).toMatchObject({ components: [{ name: 'example', version: '1.0.0' }] });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
