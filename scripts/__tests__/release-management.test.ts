import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { deriveReleaseArtifactNames } from '../release/functions/deriveArtifactNames';
import { buildCurrentReleaseModule, parseReleaseNotesMarkdown } from '../release/functions/parseReleaseNotes';
import { validateReleaseState } from '../release/functions/validateReleaseState';
import { bumpReleaseVersion } from '../release/orchestration/bumpRelease';

describe('release management', () => {
  it('derives platform artifact names from package metadata', () => {
    expect(deriveReleaseArtifactNames({ productName: '林芽', version: '0.0.36' })).toEqual({
      macDmg: '林芽-0.0.36-arm64.dmg',
      macZip: '林芽-0.0.36-arm64-mac.zip',
      macZipBlockmap: '林芽-0.0.36-arm64-mac.zip.blockmap',
      macLatestYml: 'latest-mac.yml',
      winInstaller: 'Linnya-0.0.36-win.exe',
      winInstallerBlockmap: 'Linnya-0.0.36-win.exe.blockmap',
      winLatestYml: 'latest.yml',
    });
  });

  it('parses current release notes into generated frontend data', () => {
    const notes = parseReleaseNotesMarkdown(['测试版 v0.0.36', ' - 重构了界面。', ' - 增加了 PPT 功能。'].join('\n'));

    expect(notes.version).toBe('0.0.36');
    expect(notes.notes).toEqual(['重构了界面。', '增加了 PPT 功能。']);
    expect(buildCurrentReleaseModule(notes)).toContain('"version": "0.0.36"');
  });

  it('reports drift between package, release notes and generated about data', () => {
    const fixture = makeReleaseFixture({
      packageVersion: '0.0.36',
      notesVersion: '0.0.35',
      generatedCurrentRelease: '',
      createDmgScript: 'VERSION="0.0.35"\n',
    });

    const result = validateReleaseState(fixture);

    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.path)).toEqual([
      'release-notes.md',
      'apps/renderer/domains/settings/definitions/currentRelease.generated.ts',
      'scripts/build/create-dmg.sh',
    ]);
  });

  it('reports hardcoded versions in about page and build guide', () => {
    const notes = parseReleaseNotesMarkdown('测试版 v0.0.36\n - 重构了界面。\n');
    const fixture = makeReleaseFixture({
      packageVersion: '0.0.36',
      notesVersion: '0.0.36',
      generatedCurrentRelease: buildCurrentReleaseModule(notes),
      createDmgScript: 'VERSION="$(node -p \\"require(\\\'./package.json\\\').version\\")"\n',
      aboutContent: '<h3>测试版 v0.0.36</h3>\n',
      buildGuideContent: '林芽-0.0.36-arm64.dmg\n',
    });

    const result = validateReleaseState(fixture);

    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.path)).toEqual([
      'apps/renderer/domains/settings/ui/tabs/AboutTab.vue',
      'BUILD_AND_TEST_GUIDE.md',
    ]);
  });

  it('passes when all release surfaces are synchronized', () => {
    const notes = parseReleaseNotesMarkdown('测试版 v0.0.36\n - 重构了界面。\n');
    const fixture = makeReleaseFixture({
      packageVersion: '0.0.36',
      notesVersion: '0.0.36',
      generatedCurrentRelease: buildCurrentReleaseModule(notes),
      createDmgScript: 'VERSION="$(node -p \\"require(\\\'./package.json\\\').version\\")"\n',
    });

    const result = validateReleaseState(fixture);

    expect(result.ok).toBe(true);
  });

  it('bumps package and release notes title without creating an npm lockfile', () => {
    const fixture = makeReleaseFixture({
      packageVersion: '0.0.35',
      notesVersion: '0.0.35',
      generatedCurrentRelease: '',
      createDmgScript: '',
    });

    bumpReleaseVersion(fixture, '0.0.36');

    const packageJson = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf-8')) as { version: string };
    const notes = fs.readFileSync(path.join(fixture, 'release-notes.md'), 'utf-8');

    expect(packageJson.version).toBe('0.0.36');
    expect(fs.existsSync(path.join(fixture, 'package-lock.json'))).toBe(false);
    expect(notes.startsWith('测试版 v0.0.36')).toBe(true);
  });

  it('rejects a stale npm lockfile in a pnpm workspace', () => {
    const notes = parseReleaseNotesMarkdown('测试版 v0.0.36\n - 重构了界面。\n');
    const fixture = makeReleaseFixture({
      packageVersion: '0.0.36',
      notesVersion: '0.0.36',
      generatedCurrentRelease: buildCurrentReleaseModule(notes),
      createDmgScript: 'VERSION="$(node -p \\"require(\\\'./package.json\\\').version\\")"\n',
      includePackageLock: true,
    });

    const result = validateReleaseState(fixture);

    expect(result.problems.map((problem) => problem.path)).toEqual(['package-lock.json']);
  });
});

function makeReleaseFixture(input: {
  readonly packageVersion: string;
  readonly notesVersion: string;
  readonly generatedCurrentRelease: string;
  readonly createDmgScript: string;
  readonly aboutContent?: string;
  readonly buildGuideContent?: string;
  readonly includePackageLock?: boolean;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-release-'));

  writeJson(path.join(dir, 'package.json'), {
    version: input.packageVersion,
    build: {
      productName: '林芽',
      publish: { url: 'https://download.linnyai.com/updates' },
    },
  });
  writeFile(path.join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  if (input.includePackageLock) {
    writeJson(path.join(dir, 'package-lock.json'), { lockfileVersion: 3 });
  }
  writeFile(path.join(dir, 'release-notes.md'), `测试版 v${input.notesVersion}\n - 重构了界面。\n`);
  writeFile(
    path.join(dir, 'apps/renderer/domains/settings/definitions/currentRelease.generated.ts'),
    input.generatedCurrentRelease,
  );
  writeFile(path.join(dir, 'scripts/build/create-dmg.sh'), input.createDmgScript);
  writeFile(
    path.join(dir, 'apps/renderer/domains/settings/ui/tabs/AboutTab.vue'),
    input.aboutContent ?? '<template>{{ currentRelease.title }}</template>\n',
  );
  writeFile(
    path.join(dir, 'BUILD_AND_TEST_GUIDE.md'),
    input.buildGuideContent ?? '产物名：林芽-${version}-arm64.dmg\n',
  );

  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}
