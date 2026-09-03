import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';

export interface UnknownLicensePackage {
  readonly name: string;
  readonly versions: readonly (string | null)[];
  readonly paths: readonly string[];
}

export interface DependencyLicenseEvidenceProblem {
  readonly packageName: string;
  readonly message: string;
}

export interface DependencyLicenseEvidenceResult {
  readonly problems: readonly DependencyLicenseEvidenceProblem[];
  readonly publicBlockers: readonly string[];
  readonly resolvedUnknowns: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return undefined;
  return value;
}

function readVersionArray(value: unknown): readonly (string | null)[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' && item !== null)) {
    return undefined;
  }
  return value;
}

export function readUnknownLicensePackages(report: unknown): readonly UnknownLicensePackage[] {
  if (!isRecord(report)) throw new Error('pnpm license 报告不是对象。');
  const unknownEntries = report.Unknown;
  if (unknownEntries === undefined) return [];
  if (!Array.isArray(unknownEntries)) throw new Error('pnpm license 报告的 Unknown 不是数组。');

  return unknownEntries.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Unknown[${index}] 不是对象。`);
    const name = entry.name;
    const versions = readVersionArray(entry.versions);
    const paths = readStringArray(entry.paths);
    if (typeof name !== 'string' || !versions || !paths) {
      throw new Error(`Unknown[${index}] 缺少 name、versions 或 paths。`);
    }
    return { name, versions, paths };
  });
}

function versionsEqual(
  actual: readonly (string | null)[],
  expected: readonly (string | null)[]
): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((version, index) => version === sortedExpected[index])
  );
}

function lockfileContainsIntegrity(lockfile: string, evidence: DependencyLicenseEvidence): boolean {
  if (!evidence.integrity || evidence.versions.length !== 1 || !evidence.versions[0]) return true;
  const packageHeader = `${evidence.packageName}@${evidence.versions[0]}`;
  const singleQuotedHeader = `'${packageHeader}':`;
  const unquotedHeader = `${packageHeader}:`;
  const lines = lockfile.split(/\r?\n/u);
  const headerIndex = lines.findIndex(
    line => line.trim() === singleQuotedHeader || line.trim() === unquotedHeader
  );
  if (headerIndex === -1) return false;
  return lines
    .slice(headerIndex + 1, headerIndex + 4)
    .some(line => line.includes(`integrity: ${evidence.integrity}`));
}

function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(rootDir, targetPath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function validateDependencyLicenseEvidence(input: {
  readonly rootDir: string;
  readonly report: unknown;
  readonly lockfile: string;
  readonly evidence: readonly DependencyLicenseEvidence[];
  readonly publicCandidate: boolean;
}): DependencyLicenseEvidenceResult {
  const unknownPackages = readUnknownLicensePackages(input.report);
  const problems: DependencyLicenseEvidenceProblem[] = [];
  const publicBlockers: string[] = [];
  const resolvedUnknowns: string[] = [];

  for (const unknownPackage of unknownPackages) {
    const evidence = input.evidence.find(item => item.packageName === unknownPackage.name);
    if (!evidence) {
      problems.push({
        packageName: unknownPackage.name,
        message: '出现未登记的 Unknown license。',
      });
      continue;
    }
    if (!versionsEqual(unknownPackage.versions, evidence.versions)) {
      problems.push({
        packageName: unknownPackage.name,
        message: 'Unknown license 版本与已核权 evidence 不一致。',
      });
      continue;
    }
    if (
      evidence.disposition === 'resolved' &&
      (!evidence.license || !evidence.integrity || !evidence.licenseFile)
    ) {
      problems.push({
        packageName: unknownPackage.name,
        message: '已解除的 Unknown 缺少 license、integrity 或随包许可证 evidence。',
      });
      continue;
    }
    if (!lockfileContainsIntegrity(input.lockfile, evidence)) {
      problems.push({
        packageName: unknownPackage.name,
        message: '锁文件 integrity 与已核权 evidence 不一致。',
      });
      continue;
    }
    if (evidence.licenseFile) {
      const mismatchedLicenseFile = unknownPackage.paths.some(installedRoot => {
        if (!isPathInsideRoot(input.rootDir, installedRoot)) return true;
        const licensePath = path.resolve(installedRoot, evidence.licenseFile.relativePath);
        return (
          !isPathInsideRoot(installedRoot, licensePath) ||
          !fs.existsSync(licensePath) ||
          sha256File(licensePath) !== evidence.licenseFile.sha256
        );
      });
      if (mismatchedLicenseFile) {
        problems.push({
          packageName: unknownPackage.name,
          message: '随包许可证文件缺失、越界或 hash 与 evidence 不一致。',
        });
        continue;
      }
    }
    if (evidence.disposition === 'public-blocker') {
      publicBlockers.push(unknownPackage.name);
      if (input.publicCandidate) {
        problems.push({
          packageName: unknownPackage.name,
          message: '公开候选不允许保留许可证阻断项。',
        });
      }
    } else {
      resolvedUnknowns.push(unknownPackage.name);
    }
  }

  for (const evidence of input.evidence) {
    if (!unknownPackages.some(item => item.name === evidence.packageName)) {
      problems.push({
        packageName: evidence.packageName,
        message: 'evidence 已过期：当前 Unknown 集合中不存在该 package。',
      });
    }
  }

  return { problems, publicBlockers, resolvedUnknowns };
}
