import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { evaluateRendererUiCompatibility } from '../../packages/schemas/src/plugins/renderer-ui-compatibility';
import { RENDERER_UI_VERSION } from '../../packages/renderer-ui/src/version';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pluginWorkspaceRoot = path.join(repositoryRoot, 'packages/plugins');

interface PackageManifest {
  readonly version: string;
  readonly files?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

interface PluginManifest {
  readonly entry?: { readonly renderer?: string };
  readonly compat?: { readonly rendererUi?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

function readStringMap(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some(entry => typeof entry !== 'string')) {
    throw new Error('package manifest 依赖字段必须是字符串映射');
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (typeof entry !== 'string') {
        throw new Error(`package manifest 依赖版本必须是字符串: ${key}`);
      }
      return [key, entry];
    })
  );
}

function readPackageManifest(relativePath: string): PackageManifest {
  const input = readJson(relativePath);
  if (!isRecord(input) || typeof input.version !== 'string') {
    throw new Error(`${relativePath} 缺少有效 version`);
  }
  if (
    input.files !== undefined &&
    (!Array.isArray(input.files) || input.files.some(file => typeof file !== 'string'))
  ) {
    throw new Error(`${relativePath} files 必须是字符串数组`);
  }

  const files = Array.isArray(input.files)
    ? input.files.filter((file): file is string => typeof file === 'string')
    : undefined;
  const dependencies = readStringMap(input.dependencies);
  const devDependencies = readStringMap(input.devDependencies);
  const peerDependencies = readStringMap(input.peerDependencies);
  return {
    version: input.version,
    ...(files ? { files } : {}),
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
    ...(peerDependencies ? { peerDependencies } : {}),
  };
}

function readPluginManifest(relativePath: string): PluginManifest {
  const input = readJson(relativePath);
  if (!isRecord(input)) {
    throw new Error(`${relativePath} 必须是对象`);
  }

  const entry = input.entry;
  const compat = input.compat;
  const renderer =
    isRecord(entry) && typeof entry.renderer === 'string' ? entry.renderer : undefined;
  const rendererUi =
    isRecord(compat) && typeof compat.rendererUi === 'string' ? compat.rendererUi : undefined;
  return {
    ...(renderer ? { entry: { renderer } } : {}),
    ...(rendererUi ? { compat: { rendererUi } } : {}),
  };
}

function discoverRendererPluginDirectories(): readonly string[] {
  return fs
    .readdirSync(pluginWorkspaceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(directoryName => {
      const manifestPath = `packages/plugins/${directoryName}/plugin.json`;
      if (!fs.existsSync(path.join(repositoryRoot, manifestPath))) return false;
      return Boolean(readPluginManifest(manifestPath).entry?.renderer);
    })
    .toSorted();
}

function readFollowingVersions(version: string): {
  readonly nextMinor: string;
  readonly nextMajor: string;
} {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Renderer UI 版本不是稳定 SemVer: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return {
    nextMinor: `${major}.${minor + 1}.0`,
    nextMajor: `${major + 1}.0.0`,
  };
}

describe('Renderer UI release contract', () => {
  it('版本常量、package manifest、CHANGELOG 与发布文件闭合', () => {
    const packageManifest = readPackageManifest('packages/renderer-ui/package.json');
    const changelog = fs.readFileSync(
      path.join(repositoryRoot, 'packages/renderer-ui/CHANGELOG.md'),
      'utf8'
    );

    expect(packageManifest.version).toBe(RENDERER_UI_VERSION);
    expect(packageManifest.files).toContain('CHANGELOG.md');
    expect(packageManifest.files).toContain('docs');
    expect(changelog).toContain(`## ${RENDERER_UI_VERSION}`);
    expect(
      fs.existsSync(path.join(repositoryRoot, 'packages/renderer-ui/docs/release-checklist.md'))
    ).toBe(true);
  });

  it('官方 renderer 插件共享同一 peer/manifest range，兼容 minor 且拒绝下一 major', () => {
    const { nextMinor, nextMajor } = readFollowingVersions(RENDERER_UI_VERSION);
    const rendererPluginDirectories = discoverRendererPluginDirectories();

    expect(rendererPluginDirectories.length, '至少应发现一个 renderer 插件').toBeGreaterThan(0);

    for (const directoryName of rendererPluginDirectories) {
      const packageManifest = readPackageManifest(`packages/plugins/${directoryName}/package.json`);
      const pluginManifest = readPluginManifest(`packages/plugins/${directoryName}/plugin.json`);

      const peerRange = packageManifest.peerDependencies?.['@linnya/renderer-ui'];
      const manifestRange = pluginManifest.compat?.rendererUi;
      expect(peerRange, `${directoryName} 缺少 Renderer UI peer range`).toBeTruthy();
      expect(manifestRange).toBe(peerRange);
      expect(packageManifest.devDependencies?.['@linnya/renderer-ui']).toBe('workspace:*');
      expect(packageManifest.dependencies?.['@linnya/renderer-ui']).toBeUndefined();

      expect(
        evaluateRendererUiCompatibility(RENDERER_UI_VERSION, manifestRange ?? '').compatible
      ).toBe(true);
      expect(evaluateRendererUiCompatibility(nextMinor, manifestRange ?? '').compatible).toBe(true);
      expect(evaluateRendererUiCompatibility(nextMajor, manifestRange ?? '')).toMatchObject({
        compatible: false,
        reason: 'not-satisfied',
      });
    }
  });
});
