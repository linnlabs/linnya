import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ReleaseValidationProblem, ReleaseValidationResult } from '../definitions/releaseManifest';
import { buildCurrentReleaseModule, readReleaseNotes } from './parseReleaseNotes';
import { readReleasePackageInfo } from './readPackageVersion';

function addProblem(problems: ReleaseValidationProblem[], filePath: string, message: string): void {
  problems.push({ path: filePath, message });
}

function assertNoPattern(
  problems: ReleaseValidationProblem[],
  rootDir: string,
  relativePath: string,
  pattern: RegExp,
  message: string,
): void {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  if (pattern.test(content)) {
    addProblem(problems, relativePath, message);
  }
}

export function validateReleaseState(rootDir: string): ReleaseValidationResult {
  const problems: ReleaseValidationProblem[] = [];
  const packageInfo = readReleasePackageInfo(rootDir);
  const notes = readReleaseNotes(rootDir);

  if (!fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
    addProblem(problems, 'pnpm-lock.yaml', '缺少 pnpm 唯一依赖锁文件。');
  }

  if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) {
    addProblem(problems, 'package-lock.json', '仓库已统一使用 pnpm，不应提交 npm lockfile。');
  }

  if (notes.version !== packageInfo.version) {
    addProblem(problems, 'release-notes.md', `更新日志版本是 ${notes.version}，应为 ${packageInfo.version}。`);
  }

  if (notes.notes.length === 0) {
    addProblem(problems, 'release-notes.md', '更新日志至少需要一条项目。');
  }

  const generatedPath = path.join('apps/renderer/domains/settings/definitions/currentRelease.generated.ts');
  const absoluteGeneratedPath = path.join(rootDir, generatedPath);
  const expectedGenerated = buildCurrentReleaseModule(notes);
  const actualGenerated = fs.existsSync(absoluteGeneratedPath)
    ? fs.readFileSync(absoluteGeneratedPath, 'utf-8')
    : '';

  if (actualGenerated !== expectedGenerated) {
    addProblem(problems, generatedPath, '关于页发布数据未同步，请运行 pnpm run release:generate。');
  }

  const createDmgPath = path.join(rootDir, 'scripts/build/create-dmg.sh');
  const createDmgContent = fs.readFileSync(createDmgPath, 'utf-8');
  if (/^VERSION="[\d.]+"/m.test(createDmgContent)) {
    addProblem(problems, 'scripts/build/create-dmg.sh', 'DMG 脚本仍硬编码 VERSION，应从 package.json 读取。');
  }

  assertNoPattern(
    problems,
    rootDir,
    'apps/renderer/domains/settings/ui/tabs/AboutTab.vue',
    /测试版 v\d+\.\d+\.\d+/,
    '关于页不应硬编码版本标题，应读取 currentRelease.generated.ts。',
  );

  assertNoPattern(
    problems,
    rootDir,
    'docs/development/build-and-test.md',
    /林芽-\d+\.\d+\.\d+-arm64/,
    '构建指南不应硬编码具体版本产物名，请使用 ${version} 或 release:checklist。',
  );

  return {
    ok: problems.length === 0,
    version: packageInfo.version,
    problems,
  };
}
