import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ROOT_DEPENDENCY_LICENSE_EVIDENCE } from '../definitions/dependencyLicenseEvidence';
import {
  DEPENDENCY_LICENSE_SELECTIONS,
  DEPENDENCY_SOURCE_OVERRIDES,
  DEPENDENCY_SUPPLEMENTAL_EVIDENCE_FILES,
} from '../definitions/dependencyLegalPolicy';
import {
  CRAFT_AGENTS_OAUTH_NOTICE,
  MODELS_DEV_CATALOG_NOTICE,
} from '../definitions/sourceDependencyBom';
import { REVIEWED_PACKAGE_LEGAL_EVIDENCE } from '../definitions/reviewedPackageLegalEvidence';
import { createSourceDependencyBom } from '../functions/sourceDependencyBom';

const orchestrationDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(orchestrationDirectory, '..', '..', '..');

export interface GenerateSourceDependencyBomOptions {
  readonly writeRootNotice?: boolean;
}

export function generateSourceDependencyBom(
  rootDir: string,
  options: GenerateSourceDependencyBomOptions = {}
): void {
  const licenseReportResult = spawnSync(
    'pnpm',
    ['--filter', 'linnya...', 'licenses', 'list', '--prod', '--json'],
    {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // 中文说明：JSON 只从 stdout 读取；stderr 必须直达调用方，避免 clean-room
      // 安装图出错时只剩一条无上下文的 “Command failed”。
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  if (licenseReportResult.error) throw licenseReportResult.error;
  if (licenseReportResult.status !== 0) {
    if (licenseReportResult.stdout) process.stderr.write(licenseReportResult.stdout);
    throw new Error(`pnpm licenses list 失败，退出码 ${licenseReportResult.status ?? 'unknown'}`);
  }
  const licenseReportText = licenseReportResult.stdout;
  if (!licenseReportText) throw new Error('pnpm licenses list 没有输出 JSON');
  const result = createSourceDependencyBom({
    rootDir,
    projectManifest: JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')),
    lockfile: fs.readFileSync(path.join(rootDir, 'pnpm-lock.yaml'), 'utf8'),
    licenseReport: JSON.parse(licenseReportText),
    platform: process.platform,
    architecture: process.arch,
    licenseSelections: DEPENDENCY_LICENSE_SELECTIONS,
    sourceOverrides: DEPENDENCY_SOURCE_OVERRIDES,
    supplementalEvidenceFiles: DEPENDENCY_SUPPLEMENTAL_EVIDENCE_FILES,
    supplementalNotices: [CRAFT_AGENTS_OAUTH_NOTICE, MODELS_DEV_CATALOG_NOTICE],
    unknownLicenseEvidence: ROOT_DEPENDENCY_LICENSE_EVIDENCE,
    reviewedEvidenceFiles: REVIEWED_PACKAGE_LEGAL_EVIDENCE,
    reviewedEvidenceRootDir: rootDir,
  });
  if (!result.bom || !result.notice || result.problems.length > 0) {
    const details = result.problems
      .map(problem => `- ${problem.packageIdentity}: ${problem.message}`)
      .join('\n');
    throw new Error(`Source dependency BOM 生成失败：\n${details}`);
  }

  const outputDirectory = path.join(rootDir, 'dist_release', 'bom');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = `${process.platform}-${process.arch}`;
  const bomPath = path.join(outputDirectory, `source-production-dependencies.${target}.json`);
  const noticePath = path.join(outputDirectory, `source-third-party-notices.${target}.txt`);
  fs.writeFileSync(bomPath, `${JSON.stringify(result.bom, null, 2)}\n`, 'utf8');
  fs.writeFileSync(noticePath, result.notice, 'utf8');
  if (options.writeRootNotice === true) {
    fs.writeFileSync(path.join(rootDir, 'THIRD_PARTY_NOTICES.txt'), result.notice, 'utf8');
  }
  process.stdout.write(
    `[source-bom] ${result.bom.packageCount} packages, ` +
      `${result.bom.manifestOnlyPackageCount} manifest-only evidence\n` +
      `[source-bom] ${bomPath}\n[source-bom] ${noticePath}\n` +
      (options.writeRootNotice === true
        ? `[source-bom] ${path.join(rootDir, 'THIRD_PARTY_NOTICES.txt')}\n`
        : '')
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    generateSourceDependencyBom(defaultRootDir);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
