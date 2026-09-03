import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import vitestConfig from '../../vitest.config';
import {
  discoverWorkspaceOfficialPluginReleaseTargets,
  officialPluginReleaseTargets,
} from '../release/plugin-release-targets.mjs';

const repoRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

interface RootPackageJson {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, string>>;
  readonly scripts?: Record<string, string>;
  readonly build?: {
    readonly files?: readonly unknown[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringRecord(value: unknown, fieldName: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
    throw new Error(`package.json#${fieldName} must be a string record`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'string') {
        throw new Error(`package.json#${fieldName}.${key} must be a string`);
      }
      return [key, item];
    })
  );
}

function readPackageJson(filePath: string): RootPackageJson {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${filePath} must contain a JSON object`);

  const build = isRecord(parsed.build)
    ? { files: Array.isArray(parsed.build.files) ? parsed.build.files : undefined }
    : undefined;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    exports: readStringRecord(parsed.exports, 'exports'),
    scripts: readStringRecord(parsed.scripts, 'scripts'),
    build,
  };
}

interface PnpmWorkspaceYaml {
  readonly content: string;
}

function readWorkspaceYaml(): PnpmWorkspaceYaml {
  return {
    content: fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  };
}

function readBuildFiles(): readonly unknown[] {
  const packageJson = readPackageJson(path.join(repoRoot, 'package.json'));
  return packageJson.build?.files ?? [];
}

function readRootScripts(): Record<string, string> {
  const packageJson = readPackageJson(path.join(repoRoot, 'package.json'));
  return packageJson.scripts ?? {};
}

function listAliasEntries(): readonly { readonly find: unknown; readonly replacement: string }[] {
  const config =
    typeof vitestConfig === 'function'
      ? vitestConfig({ mode: 'test', command: 'serve' })
      : vitestConfig;
  const alias = config.resolve?.alias;
  if (!Array.isArray(alias)) {
    throw new Error(
      'vitest alias must stay in array form so plugin source aliases keep deterministic priority.'
    );
  }
  return alias.filter(
    (entry): entry is { readonly find: unknown; readonly replacement: string } => {
      return (
        typeof entry === 'object' && entry !== null && 'find' in entry && 'replacement' in entry
      );
    }
  );
}

function listPluginSharedSourceAliases(packageDirectories: readonly string[]): readonly {
  readonly pattern: string;
  readonly suffix: string;
}[] {
  return packageDirectories
    .flatMap(relativePackageDir => {
      const packageDir = path.join(repoRoot, relativePackageDir);
      const packageJsonPath = path.join(packageDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) return [];

      const packageJson = readPackageJson(packageJsonPath);
      const sharedTarget = packageJson.exports?.['./shared'];
      if (!packageJson.name || !sharedTarget?.startsWith('./')) return [];

      return [
        {
          pattern: String(new RegExp(`^${escapeRegExp(packageJson.name)}/shared$`)),
          suffix: path.posix.join(relativePackageDir, sharedTarget.slice(2)),
        },
      ];
    })
    .toSorted((left, right) => left.pattern.localeCompare(right.pattern));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('plugin workspace packaging guard', () => {
  it('registers official plugin packages as workspace members', () => {
    expect(readWorkspaceYaml().content).toContain('- packages/plugins/*');
  });

  it('keeps every official plugin package on the same artifact build surface', () => {
    const scripts = readRootScripts();
    for (const target of officialPluginReleaseTargets) {
      const packageJson = readPackageJson(path.join(repoRoot, target.packageDir, 'package.json'));
      expect(packageJson.scripts?.['package:artifact']).toContain(
        'scripts/release/package-plugin-artifact.mjs'
      );
    }

    expect(scripts['package:plugins:official']).toBe(
      'node scripts/release/run-official-plugin-scripts.mjs package'
    );
    expect(scripts['smoke:plugins:official:artifact']).toBe(
      'node scripts/release/run-official-plugin-scripts.mjs smoke-artifact'
    );
    expect(scripts['smoke:plugins:official:r2']).toBe(
      'pnpm run build:schemas && vitest run scripts/release/smoke-official-plugins-r2.test.ts'
    );
  });

  it('discovers an owner-declared workspace release target without Core knowing its id or path', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-release-target-'));
    temporaryRoots.push(temporaryRoot);
    const packageDir = path.join(temporaryRoot, 'packages/plugins/private-addon');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@plugin/private-addon',
        linnya: {
          release: {
            includeInOfficialRelease: true,
          },
        },
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(packageDir, 'plugin.json'),
      JSON.stringify({
        id: 'private-addon',
        entry: {
          backend: './dist/backend/index.cjs',
          renderer: './dist/renderer/index.js',
        },
      }),
      'utf8'
    );

    expect(discoverWorkspaceOfficialPluginReleaseTargets(temporaryRoot)).toEqual([
      {
        id: 'private-addon',
        packageDir: 'packages/plugins/private-addon',
        defaultR2Prefix: 'plugins/private-addon',
        defaultDownloadBaseUrl: 'https://download.linnyai.com/plugins/private-addon',
        productionDistDirectories: ['dist/backend', 'dist/renderer'],
      },
    ]);
  });

  it('does not forward the npm argument separator through nested pnpm scripts', () => {
    const npmStyleSeparator = /\bpnpm(?:\s+--dir\s+\S+)?\s+run\s+\S+\s+--(?:\s|$)/;
    const offenders = Object.entries(readRootScripts())
      .filter(([, command]) => npmStyleSeparator.test(command))
      .map(([scriptName]) => scriptName);

    expect(offenders).toEqual([]);
  });

  it('excludes workspace plugin symlinks from electron-builder asar files', () => {
    const files = readBuildFiles();

    expect(files).toContain('node_modules/**/*');
    expect(files).toContain('!node_modules/@plugin/**');
    expect(files.indexOf('!node_modules/@plugin/**')).toBeGreaterThan(
      files.indexOf('node_modules/**/*')
    );
  });

  it('keeps public plugin entries resolved to package source before the generic SDK alias', () => {
    const aliasEntries = listAliasEntries();
    const genericPluginAliasIndex = aliasEntries.findIndex(
      entry => String(entry.find) === '/^@plugin\\/(.+)$/'
    );
    expect(genericPluginAliasIndex).toBeGreaterThan(-1);

    const workspaceDeclaredDirectories = new Set(
      discoverWorkspaceOfficialPluginReleaseTargets(repoRoot).map(target => target.packageDir)
    );
    const expectedSourceAliases = listPluginSharedSourceAliases(
      officialPluginReleaseTargets
        .map(target => target.packageDir)
        .filter(packageDir => !workspaceDeclaredDirectories.has(packageDir))
    );

    for (const expected of expectedSourceAliases) {
      const aliasIndex = aliasEntries.findIndex(entry => String(entry.find) === expected.pattern);
      expect(aliasIndex).toBeGreaterThan(-1);
      expect(aliasIndex).toBeLessThan(genericPluginAliasIndex);
      expect(aliasEntries[aliasIndex]?.replacement).toBe(path.join(repoRoot, expected.suffix));
    }
  });

  it('keeps owner-declared private plugin aliases in the plugin test config, not the Core config', () => {
    const rootAliases = listAliasEntries();
    const workspaceTargets = discoverWorkspaceOfficialPluginReleaseTargets(repoRoot);

    for (const target of workspaceTargets) {
      const packageDirectory = path.join(repoRoot, target.packageDir);
      const packageJson = readPackageJson(path.join(packageDirectory, 'package.json'));
      const packageName = packageJson.name;
      if (packageName === undefined) throw new Error(`${target.packageDir}/package.json 缺少 name`);

      const sharedPattern = String(new RegExp(`^${escapeRegExp(packageName)}/shared$`));
      expect(rootAliases.findIndex(entry => String(entry.find) === sharedPattern)).toBe(-1);

      const pluginVitestConfig = path.join(packageDirectory, 'vitest.config.ts');
      expect(fs.existsSync(pluginVitestConfig)).toBe(true);
      const configSource = fs.readFileSync(pluginVitestConfig, 'utf8');
      expect(configSource).toContain('createPluginVitestConfig');
      expect(configSource).toContain(target.id);
      expect(packageJson.scripts?.test).toContain('--config vitest.config.ts');
    }
  });
});
