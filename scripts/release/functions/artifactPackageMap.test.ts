import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ArtifactContentBom, ArtifactContentEntry } from '../definitions/artifactContentBom';
import {
  createArtifactPackageMap,
  resolveCanonicalArtifactPackageRoot,
} from './artifactPackageMap';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function file(
  scope: ArtifactContentEntry['scope'],
  path: string,
  category: ArtifactContentEntry['category']
): ArtifactContentEntry {
  return {
    type: 'file',
    scope,
    path,
    category,
    executable: false,
    size: path.length,
    sha256: hash(path),
  };
}

function contentBom(
  entries: readonly ArtifactContentEntry[],
  lockSha256: string
): ArtifactContentBom {
  return {
    schemaVersion: 1,
    kind: 'linnya-desktop-artifact-content',
    identity: {
      name: 'Linnya',
      version: '1.0.0',
      platform: 'darwin',
      architecture: 'arm64',
    },
    source: { revision: 'a'.repeat(40), dirty: false },
    environment: {
      nodeVersion: 'v24.18.0',
      platform: 'darwin',
      architecture: 'arm64',
      productionPackageLockSha256: lockSha256,
    },
    artifacts: [],
    entries,
    summary: {
      fileCount: entries.length,
      symlinkCount: 0,
      fileSize: entries.reduce(
        (total, entry) => total + (entry.type === 'file' ? entry.size : 0),
        0
      ),
      scopeCounts: {
        'app-asar': entries.filter(entry => entry.scope === 'app-asar').length,
        'app-filesystem': entries.filter(entry => entry.scope === 'app-filesystem').length,
        'plugin-archive': 0,
      },
      treeSha256: hash(JSON.stringify(entries)),
    },
  };
}

describe('artifact package map', () => {
  it('按 package identity 对齐打包器重排后的 npm 位置，并覆盖 asarUnpack 副本', () => {
    const lockSha256 = hash('lock');
    const entries = [
      file('app-asar', 'node_modules/example/package.json', 'production-dependency'),
      file('app-asar', 'node_modules/example/index.js', 'production-dependency'),
      file(
        'app-asar',
        'node_modules/example/node_modules/child/package.json',
        'production-dependency'
      ),
      file('app-asar', 'node_modules/example/node_modules/child/index.js', 'production-dependency'),
      file('app-asar', 'node_modules/@app/schemas/package.json', 'production-dependency'),
      file('app-asar', 'node_modules/@app/schemas/dist/index.js', 'production-dependency'),
      file(
        'app-filesystem',
        'Contents/Resources/app.asar.unpacked/node_modules/example/index.js',
        'production-dependency'
      ),
      file('app-asar', 'dist/main.cjs', 'application-code'),
      file(
        'app-filesystem',
        'Contents/Frameworks/Electron Framework.framework/Electron Framework',
        'electron-runtime'
      ),
    ];
    const map = createArtifactPackageMap({
      contentBom: contentBom(entries, lockSha256),
      contentBomSha256: hash('content-bom'),
      productionPackageLockSha256: lockSha256,
      packageManifests: [
        {
          packageJsonPath: 'node_modules/example/package.json',
          sha256: hash('example-manifest'),
          manifest: { name: 'example', version: '2.0.0', license: 'MIT' },
        },
        {
          packageJsonPath: 'node_modules/example/node_modules/child/package.json',
          sha256: hash('child-manifest'),
          manifest: { name: 'child', version: '1.0.0', license: 'ISC' },
        },
        {
          packageJsonPath: 'node_modules/example/dist/package.json',
          sha256: hash('internal-manifest'),
          manifest: { name: 'example', version: '2.0.0', license: 'MIT' },
        },
        {
          packageJsonPath: 'node_modules/@app/schemas/package.json',
          sha256: hash('schemas-manifest'),
          manifest: { name: '@app/schemas', version: '1.0.0' },
        },
      ],
      productionPackageLock: {
        lockfileVersion: 3,
        packages: {
          '': { name: 'linnya', version: '1.0.0' },
          'node_modules/parent/node_modules/example': {
            version: '2.0.0',
            resolved: 'https://registry.npmjs.org/example/-/example-2.0.0.tgz',
            integrity: 'sha512-example',
            license: 'MIT',
          },
          'node_modules/example/node_modules/child': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/child/-/child-1.0.0.tgz',
            integrity: 'sha512-child',
            license: 'ISC',
          },
          'node_modules/@app/schemas': { resolved: 'packages/schemas', link: true },
          'packages/schemas': { name: '@app/schemas', version: '1.0.0' },
        },
      },
    });

    expect(map.summary).toEqual({
      packageComponentCount: 3,
      packageLocationCount: 3,
      asarPackageEntryCount: 6,
      unpackedPackageEntryCount: 1,
    });
    expect(map.components.find(component => component.name === 'example')).toMatchObject({
      id: 'registry:example@2.0.0',
      lockLocations: ['node_modules/parent/node_modules/example'],
      locations: [
        {
          asarPath: 'node_modules/example',
          asarEntryCount: 2,
          unpackedEntryCount: 1,
          unpackedPath: 'Contents/Resources/app.asar.unpacked/node_modules/example',
        },
      ],
    });
    expect(map.components.find(component => component.name === '@app/schemas')).toMatchObject({
      installKind: 'workspace',
      integrities: [],
    });
    expect(map.limitations.map(item => [item.code, item.entryCount])).toEqual([
      ['compiled-bundle-inputs-not-attributed', 1],
      ['non-npm-runtime-components-not-attributed', 1],
      ['license-evidence-not-attached', 3],
    ]);
  });

  it('只把 canonical node_modules package.json 当成 package 根', () => {
    expect(resolveCanonicalArtifactPackageRoot('node_modules/vue/package.json', 'vue')).toBe(
      'node_modules/vue'
    );
    expect(
      resolveCanonicalArtifactPackageRoot('node_modules/@vue/shared/package.json', '@vue/shared')
    ).toBe('node_modules/@vue/shared');
    expect(
      resolveCanonicalArtifactPackageRoot('node_modules/entities/dist/esm/package.json', 'entities')
    ).toBeUndefined();
  });

  it('拒绝 artifact 中存在但 production lock 无此 identity 的 package', () => {
    const lockSha256 = hash('lock');
    expect(() =>
      createArtifactPackageMap({
        contentBom: contentBom(
          [file('app-asar', 'node_modules/unknown/package.json', 'production-dependency')],
          lockSha256
        ),
        contentBomSha256: hash('content-bom'),
        productionPackageLockSha256: lockSha256,
        packageManifests: [
          {
            packageJsonPath: 'node_modules/unknown/package.json',
            sha256: hash('unknown-manifest'),
            manifest: { name: 'unknown', version: '1.0.0', license: 'MIT' },
          },
        ],
        productionPackageLock: { lockfileVersion: 3, packages: {} },
      })
    ).toThrow('不在 production lock');
  });
});
