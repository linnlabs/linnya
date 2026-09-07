import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';
import type {
  DependencyLicenseSelection,
  DependencySourceOverride,
  DependencySupplementalEvidenceFile,
  PackageLegalDocument,
  PackageLegalEvidenceFile,
  ReviewedPackageLegalEvidence,
} from '../definitions/packageLegalEvidence';
import type { SourceDependencySupplementalNotice } from '../definitions/sourceDependencyBom';
import { collectPackageLegalEvidence, packageIdentity } from './packageLegalEvidence';

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface InstalledDependencyReference {
  readonly declaredLicense: string;
  readonly installedRoot: string;
  readonly packageName: string;
  readonly version: string;
}

export type SourceDependencyBomEvidenceFile = PackageLegalEvidenceFile;

export interface SourceDependencyBomPackage {
  readonly declaredLicense: string;
  readonly evidence: 'files' | 'manifest-only';
  readonly evidenceFiles: readonly SourceDependencyBomEvidenceFile[];
  readonly integrity: string;
  readonly licenseConclusionReason?: string;
  readonly name: string;
  readonly selectedLicense: string;
  readonly source: string;
  readonly version: string;
}

export type SourceDependencyLicenseDocument = PackageLegalDocument;

export interface SourceDependencySupplementalNoticeDescriptor {
  readonly id: string;
  readonly licenseExpression: string;
  readonly sha256: string;
  readonly source: string;
  readonly title: string;
}

export interface SourceDependencyBom {
  readonly architecture: string;
  readonly kind: 'linnya-source-production-dependencies';
  readonly licenseDocuments: readonly Omit<SourceDependencyLicenseDocument, 'content'>[];
  readonly lockfileSha256: string;
  readonly manifestOnlyPackageCount: number;
  readonly packageCount: number;
  readonly packages: readonly SourceDependencyBomPackage[];
  readonly platform: string;
  readonly project: Readonly<{ name: string; version: string }>;
  readonly schemaVersion: 3;
  readonly supplementalNotices: readonly SourceDependencySupplementalNoticeDescriptor[];
}

export interface SourceDependencyBomProblem {
  readonly packageIdentity: string;
  readonly message: string;
}

export interface SourceDependencyBomResult {
  readonly bom?: SourceDependencyBom;
  readonly notice?: string;
  readonly problems: readonly SourceDependencyBomProblem[];
}

export interface CreateSourceDependencyBomInput {
  readonly architecture: string;
  readonly licenseReport: unknown;
  readonly licenseSelections: readonly DependencyLicenseSelection[];
  readonly lockfile: string;
  readonly projectManifest: unknown;
  readonly rootDir: string;
  readonly reviewedEvidenceFiles: readonly ReviewedPackageLegalEvidence[];
  readonly reviewedEvidenceRootDir: string;
  readonly sourceOverrides: readonly DependencySourceOverride[];
  readonly supplementalEvidenceFiles: readonly DependencySupplementalEvidenceFile[];
  readonly supplementalNotices: readonly SourceDependencySupplementalNotice[];
  readonly unknownLicenseEvidence: readonly DependencyLicenseEvidence[];
  readonly platform: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} 缺少字符串 ${key}`);
  }
  return value;
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function readProjectIdentity(manifest: unknown): Readonly<{ name: string; version: string }> {
  if (!isRecord(manifest)) throw new Error('根 package.json 必须是对象');
  return Object.freeze({
    name: readRequiredString(manifest, 'name', '根 package.json'),
    version: readRequiredString(manifest, 'version', '根 package.json'),
  });
}

function readInstalledDependencyReferences(
  report: unknown
): readonly InstalledDependencyReference[] {
  if (!isRecord(report)) throw new Error('pnpm license 报告必须是对象');
  const references: InstalledDependencyReference[] = [];
  for (const [declaredLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) throw new Error(`pnpm license ${declaredLicense} 必须是数组`);
    for (const [entryIndex, entry] of entries.entries()) {
      if (!isRecord(entry)) throw new Error(`${declaredLicense}[${entryIndex}] 必须是对象`);
      const packageName = readRequiredString(entry, 'name', `${declaredLicense}[${entryIndex}]`);
      const versions = entry.versions;
      const installedRoots = entry.paths;
      if (
        !Array.isArray(versions) ||
        versions.some(version => typeof version !== 'string') ||
        !Array.isArray(installedRoots) ||
        installedRoots.some(installedRoot => typeof installedRoot !== 'string')
      ) {
        throw new Error(`${declaredLicense}[${entryIndex}] 缺少 versions/paths`);
      }
      for (const installedRoot of installedRoots) {
        const manifestPath = path.join(installedRoot, 'package.json');
        const manifestValue: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!isRecord(manifestValue)) throw new Error(`${manifestPath} 必须是对象`);
        const installedName = readRequiredString(manifestValue, 'name', manifestPath);
        const version = readRequiredString(manifestValue, 'version', manifestPath);
        if (installedName !== packageName || !versions.includes(version)) {
          throw new Error(`${packageName} 的 license report 与安装 manifest 不一致`);
        }
        references.push({ declaredLicense, installedRoot, packageName, version });
      }
    }
  }
  return references;
}

function readLockfileIntegrities(lockfile: string): ReadonlyMap<string, string> {
  const parsed: unknown = parseYaml(lockfile);
  if (!isRecord(parsed) || !isRecord(parsed.packages)) {
    throw new Error('pnpm-lock.yaml 缺少 packages');
  }
  const importerDependencyNames = new Map<string, Set<string>>();
  if (isRecord(parsed.importers)) {
    for (const importer of Object.values(parsed.importers)) {
      if (!isRecord(importer)) continue;
      for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const section = importer[sectionName];
        if (!isRecord(section)) continue;
        for (const [packageName, dependency] of Object.entries(section)) {
          if (!isRecord(dependency) || typeof dependency.version !== 'string') continue;
          const names = importerDependencyNames.get(dependency.version) ?? new Set<string>();
          names.add(packageName);
          importerDependencyNames.set(dependency.version, names);
        }
      }
    }
  }
  const byIdentity = new Map<string, Set<string>>();
  const addIntegrity = (identity: string, integrity: string): void => {
    const integrities = byIdentity.get(identity) ?? new Set<string>();
    integrities.add(integrity);
    byIdentity.set(identity, integrities);
  };
  for (const [lockfileKey, packageRecord] of Object.entries(parsed.packages)) {
    if (!isRecord(packageRecord) || !isRecord(packageRecord.resolution)) continue;
    const integrity = packageRecord.resolution.integrity;
    if (typeof integrity !== 'string' || !integrity) continue;
    const peerSuffixIndex = lockfileKey.indexOf('(');
    const identity = peerSuffixIndex === -1 ? lockfileKey : lockfileKey.slice(0, peerSuffixIndex);
    addIntegrity(identity, integrity);

    // pnpm 会把 URL tarball 按 URL 本身作为 key（例如 xlsx@https://...），而许可证报告
    // 按包名和 manifest 版本标识已安装包；importer 条目是锁文件中连接这两种 identity 的事实来源。
    if (lockfileKey.includes('://') && typeof packageRecord.version === 'string') {
      const tarball = packageRecord.resolution.tarball;
      const importerNames =
        (typeof tarball === 'string' && importerDependencyNames.get(tarball)) ??
        importerDependencyNames.get(lockfileKey) ??
        [];
      for (const packageName of importerNames) {
        addIntegrity(`${packageName}@${packageRecord.version}`, integrity);
      }
    }
  }
  const result = new Map<string, string>();
  for (const [identity, integrities] of byIdentity) {
    if (integrities.size !== 1) throw new Error(`${identity} 对应多个 registry integrity`);
    const integrity = integrities.values().next().value;
    if (typeof integrity === 'string') result.set(identity, integrity);
  }
  return result;
}

function readSupplementalNotices(
  notices: readonly SourceDependencySupplementalNotice[]
): readonly (SourceDependencySupplementalNoticeDescriptor & Readonly<{ content: string }>)[] {
  const ids = new Set<string>();
  return notices
    .map(notice => {
      const content = notice.content.trim();
      if (
        !notice.id.trim() ||
        !notice.title.trim() ||
        !notice.source.trim() ||
        !notice.licenseExpression.trim() ||
        !content
      ) {
        throw new Error('补充 NOTICE 的 id/title/source/license/content 不能为空');
      }
      if (ids.has(notice.id)) throw new Error(`补充 NOTICE id 重复：${notice.id}`);
      ids.add(notice.id);
      return { ...notice, content, sha256: sha256(content) };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function renderThirdPartyNotice(
  project: Readonly<{ name: string; version: string }>,
  platform: string,
  architecture: string,
  packages: readonly SourceDependencyBomPackage[],
  documents: readonly SourceDependencyLicenseDocument[],
  supplementalNotices: readonly (SourceDependencySupplementalNoticeDescriptor &
    Readonly<{ content: string }>)[]
): string {
  const manifestOnly = packages.filter(item => item.evidence === 'manifest-only');
  const lines = [
    'LINNYA THIRD-PARTY PRODUCTION DEPENDENCY NOTICE',
    '',
    `Project: ${project.name}@${project.version}`,
    `Target: ${platform}/${architecture}`,
    '',
    'This deterministic inventory is generated from the installed production dependency graph.',
    'Desktop installers and plugin artifacts require their own content-derived BOM verification.',
    '',
    'PACKAGES',
    '',
    ...packages.map(item => {
      const license = item.licenseConclusionReason
        ? `declared ${item.declaredLicense}; concluded ${item.selectedLicense} (${item.licenseConclusionReason})`
        : item.selectedLicense;
      return `- ${item.name}@${item.version} — ${license} — ${item.source} — ${item.integrity}`;
    }),
    '',
    'PACKAGES WITH MANIFEST-ONLY LICENSE EVIDENCE',
    '',
    ...(manifestOnly.length === 0
      ? ['None.']
      : manifestOnly.map(
          item =>
            `- ${item.name}@${item.version} — declared ${item.declaredLicense} — ${item.source}`
        )),
    '',
    'SUPPLEMENTAL COMPONENT, DATA, AND ASSET NOTICES',
    '',
    ...(supplementalNotices.length === 0
      ? ['None.', '']
      : supplementalNotices.flatMap(notice => [
          `----- ${notice.title} (${notice.id}) ${notice.sha256} -----`,
          `Source: ${notice.source}`,
          `License: ${notice.licenseExpression}`,
          '',
          notice.content,
          '',
        ])),
    'LICENSE AND NOTICE TEXTS',
    '',
  ];
  for (const document of documents) {
    lines.push(
      `----- ${document.kind.toUpperCase()} ${document.sha256} -----`,
      `Applies to: ${document.appliesTo.join(', ')}`,
      `Installed file names: ${document.fileNames.join(', ')}`,
      '',
      document.content,
      ''
    );
  }
  // 上游法律文本可能混用 CRLF 或在引用块中保留行尾空格。NOTICE 内容保持逐字信息，
  // 但统一仓库文本格式，避免生成文件无法通过 diff 门禁。
  const normalizedLines = lines
    .join('\n')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map(line => line.trimEnd());
  return `${normalizedLines.join('\n').trimEnd()}\n`;
}

export function createSourceDependencyBom(
  input: CreateSourceDependencyBomInput
): SourceDependencyBomResult {
  let references: readonly InstalledDependencyReference[];
  let lockfileIntegrities: ReadonlyMap<string, string>;
  let project: Readonly<{ name: string; version: string }>;
  let supplementalNotices: readonly (SourceDependencySupplementalNoticeDescriptor &
    Readonly<{ content: string }>)[];
  try {
    references = readInstalledDependencyReferences(input.licenseReport);
    lockfileIntegrities = readLockfileIntegrities(input.lockfile);
    project = readProjectIdentity(input.projectManifest);
    supplementalNotices = readSupplementalNotices(input.supplementalNotices);
  } catch (error) {
    return {
      problems: [
        {
          packageIdentity: '(input)',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const legalEvidence = collectPackageLegalEvidence({
    rootDir: input.rootDir,
    references: references.map(reference => ({
      ...reference,
      integrity: lockfileIntegrities.get(packageIdentity(reference.packageName, reference.version)),
    })),
    requireIntegrity: true,
    licenseSelections: input.licenseSelections,
    sourceOverrides: input.sourceOverrides,
    supplementalEvidenceFiles: input.supplementalEvidenceFiles,
    unknownLicenseEvidence: input.unknownLicenseEvidence,
    reviewedEvidenceFiles: input.reviewedEvidenceFiles,
    reviewedEvidenceRootDir: input.reviewedEvidenceRootDir,
  });
  if (legalEvidence.problems.length > 0) return { problems: legalEvidence.problems };

  const packages: SourceDependencyBomPackage[] = legalEvidence.packages.map(item => {
    if (!item.integrity) {
      throw new Error(`${packageIdentity(item.name, item.version)} 缺少已验证 integrity`);
    }
    return {
      name: item.name,
      version: item.version,
      declaredLicense: item.declaredLicense,
      selectedLicense: item.selectedLicense,
      source: item.source,
      integrity: item.integrity,
      ...(item.licenseConclusionReason
        ? { licenseConclusionReason: item.licenseConclusionReason }
        : {}),
      evidence: item.evidence,
      evidenceFiles: item.evidenceFiles,
    };
  });
  const bom: SourceDependencyBom = {
    schemaVersion: 3,
    kind: 'linnya-source-production-dependencies',
    project,
    platform: input.platform,
    architecture: input.architecture,
    lockfileSha256: sha256(input.lockfile),
    packageCount: packages.length,
    manifestOnlyPackageCount: packages.filter(item => item.evidence === 'manifest-only').length,
    packages,
    licenseDocuments: legalEvidence.documents.map(({ content: _content, ...document }) => document),
    supplementalNotices: supplementalNotices.map(({ content: _content, ...notice }) => notice),
  };
  return {
    bom,
    notice: renderThirdPartyNotice(
      project,
      input.platform,
      input.architecture,
      packages,
      legalEvidence.documents,
      supplementalNotices
    ),
    problems: [],
  };
}
