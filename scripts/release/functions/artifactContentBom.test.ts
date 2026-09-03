import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ArtifactContentEntry } from '../definitions/artifactContentBom';
import {
  classifyDesktopArtifactPath,
  classifyPluginArtifactPath,
  createArtifactContentBom,
} from './artifactContentBom';

function hash(algorithm: 'sha256' | 'sha512', content: string): string {
  return createHash(algorithm).update(content).digest('hex');
}

describe('artifact content BOM', () => {
  it('按 scope/path 确定性排序，并让 tree hash 覆盖文件与符号链接', () => {
    const entries: readonly ArtifactContentEntry[] = [
      {
        type: 'symlink',
        scope: 'app-filesystem',
        path: 'Frameworks/A.framework/Versions/Current',
        target: 'A',
        category: 'electron-runtime',
      },
      {
        type: 'file',
        scope: 'app-asar',
        path: 'dist/main.cjs',
        category: 'application-code',
        executable: false,
        size: 4,
        sha256: hash('sha256', 'main'),
      },
    ];
    const create = (candidateEntries: readonly ArtifactContentEntry[]) =>
      createArtifactContentBom({
        kind: 'linnya-desktop-artifact-content',
        identity: {
          name: 'Linnya',
          version: '1.0.0',
          platform: 'darwin',
          architecture: 'arm64',
        },
        source: { revision: 'a'.repeat(40), dirty: false },
        environment: { nodeVersion: 'v22.23.1', platform: 'darwin', architecture: 'arm64' },
        artifacts: [
          {
            fileName: 'Linnya.dmg',
            role: 'desktop-installer',
            size: 3,
            sha256: hash('sha256', 'dmg'),
            sha512: hash('sha512', 'dmg'),
          },
        ],
        entries: candidateEntries,
      });

    const bom = create(entries);
    expect(bom.entries.map(entry => `${entry.scope}:${entry.path}`)).toEqual([
      'app-asar:dist/main.cjs',
      'app-filesystem:Frameworks/A.framework/Versions/Current',
    ]);
    expect(bom.summary).toMatchObject({
      fileCount: 1,
      symlinkCount: 1,
      fileSize: 4,
      scopeCounts: { 'app-asar': 1, 'app-filesystem': 1, 'plugin-archive': 0 },
    });
    expect(create([...entries].reverse()).summary.treeSha256).toBe(bom.summary.treeSha256);
  });

  it('拒绝重复逻辑路径和本机绝对路径', () => {
    const entry: ArtifactContentEntry = {
      type: 'file',
      scope: 'plugin-archive',
      path: 'plugin.json',
      category: 'plugin-manifest',
      executable: false,
      size: 2,
      sha256: hash('sha256', '{}'),
    };
    const create = (entries: readonly ArtifactContentEntry[]) =>
      createArtifactContentBom({
        kind: 'linnya-plugin-artifact-content',
        identity: { name: 'demo', pluginId: 'demo', version: '1.0.0' },
        source: { revision: 'b'.repeat(40), dirty: true },
        environment: { nodeVersion: 'v22.23.1', platform: 'darwin', architecture: 'arm64' },
        artifacts: [
          {
            fileName: 'demo-1.0.0.zip',
            role: 'plugin-archive',
            size: 3,
            sha256: hash('sha256', 'zip'),
            sha512: hash('sha512', 'zip'),
          },
        ],
        entries,
      });

    expect(() => create([entry, entry])).toThrow('重复内容路径');
    expect(() => create([{ ...entry, path: '/Users/person/plugin.json' }])).toThrow(
      '不能是绝对路径'
    );
    expect(() => create([{ ...entry, path: '../plugin.json' }])).toThrow('内容路径无效');
  });

  it('用结构而非具体插件 ID 归类正式内容', () => {
    expect(classifyPluginArtifactPath('dist/backend/index.cjs')).toBe('plugin-backend-runtime');
    expect(classifyPluginArtifactPath('dist/renderer/index.js')).toBe('plugin-renderer-runtime');
    expect(classifyPluginArtifactPath('resources/skills/demo/SKILL.md')).toBe('plugin-resource');
    expect(
      classifyDesktopArtifactPath('resources/plugins/example/plugin.json', 'app-filesystem')
    ).toBe('plugin-resource');
    expect(classifyDesktopArtifactPath('node_modules/vue/index.js', 'app-asar')).toBe(
      'production-dependency'
    );
    expect(
      classifyDesktopArtifactPath(
        'Contents/Resources/app.asar.unpacked/node_modules/sharp/lib/index.js',
        'app-filesystem'
      )
    ).toBe('production-dependency');
    expect(
      classifyDesktopArtifactPath(
        'resources/app.asar.unpacked/dist/main/app-server-entry.cjs',
        'app-filesystem'
      )
    ).toBe('application-code');
  });
});
