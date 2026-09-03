import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';
import type {
  CollectPackageLegalEvidenceInput,
  DependencyLicenseSelection,
  InstalledPackageLegalReference,
  PackageLegalDocument,
  PackageLegalEvidenceFile,
  PackageLegalEvidenceRecord,
  PackageLegalEvidenceResult,
  PackageLicenseDeclarationSource,
  ReviewedPackageLegalEvidence,
  ReviewedPackageLegalEvidenceFile,
} from '../definitions/packageLegalEvidence';

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface LicenseDeclaration {
  readonly expression: string;
  readonly source: PackageLicenseDeclarationSource;
}

const STANDARD_EVIDENCE_FILE_PATTERN =
  /^(?:licen[cs]e|copying|copyright|notice|third[-_.]?party)(?:$|[-_.])/iu;

// `BSD` 无法说明二条款还是三条款；必须用精确版本的人工结论解除。
const AMBIGUOUS_LICENSE_EXPRESSIONS = new Set(['BSD']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function packageIdentity(packageName: string, version: string): string {
  return `${packageName}@${version}`;
}

function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(rootDir, targetPath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertInstalledRootInside(rootDir: string, installedRoot: string): void {
  if (!isPathInsideRoot(rootDir, installedRoot)) {
    throw new Error('安装路径位于允许根目录之外');
  }
  const realRoot = fs.realpathSync(rootDir);
  const realInstalledRoot = fs.realpathSync(installedRoot);
  if (!isPathInsideRoot(realRoot, realInstalledRoot)) {
    throw new Error('安装路径的符号链接目标位于允许根目录之外');
  }
}

function normalizeSource(rawSource: string): string {
  let source = rawSource.trim();
  source = source.replace(/^github:/u, 'https://github.com/');
  source = source.replace(/^gitlab:/u, 'https://gitlab.com/');
  source = source.replace(/^git\+/u, '');
  source = source.replace(/^git:\/\/github\.com\//u, 'https://github.com/');
  source = source.replace(/^ssh:\/\/git@github\.com\//u, 'https://github.com/');
  source = source.replace(/^git@github\.com:/u, 'https://github.com/');
  source = source.replace(/^http:\/\/github\.com\//u, 'https://github.com/');
  if (/^[\w.-]+\/[\w.-]+$/u.test(source)) source = `https://github.com/${source}`;
  return source.replace(/\.git(?=$|#)/u, '');
}

function readRepositorySource(manifest: JsonRecord): string | undefined {
  const repository = manifest.repository;
  if (typeof repository === 'string' && repository.trim()) return normalizeSource(repository);
  if (isRecord(repository)) {
    const url = repository.url;
    if (typeof url === 'string' && url.trim()) return normalizeSource(url);
  }
  const homepage = manifest.homepage;
  return typeof homepage === 'string' && homepage.trim() ? normalizeSource(homepage) : undefined;
}

function readLegacyLicenseType(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.type === 'string' && value.type.trim()) {
    return value.type.trim();
  }
  throw new Error(`${label} 不是可识别的旧式 license declaration`);
}

/**
 * npm 已弃用 license object / licenses[]，但老包仍可能携带。这里仅忠实读取随包声明；
 * 多个旧式条目按 npm 文档给出的迁移方式投影为 OR，不从许可证正文猜测。
 */
export function readManifestLicenseDeclaration(manifest: unknown): LicenseDeclaration | undefined {
  if (!isRecord(manifest)) throw new Error('安装 package.json 必须是对象');
  const license = manifest.license;
  if (typeof license === 'string' && license.trim()) {
    return { expression: license.trim(), source: 'manifest-license' };
  }
  if (license !== undefined) {
    return {
      expression: readLegacyLicenseType(license, 'manifest license'),
      source: 'manifest-legacy-license',
    };
  }
  const licenses = manifest.licenses;
  if (licenses === undefined) return undefined;
  if (!Array.isArray(licenses) || licenses.length === 0) {
    throw new Error('manifest licenses 不是非空数组');
  }
  const expressions = [
    ...new Set(
      licenses.map((item, index) => readLegacyLicenseType(item, `manifest licenses[${index}]`))
    ),
  ];
  return {
    expression: expressions.length === 1 ? expressions[0] : `(${expressions.join(' OR ')})`,
    source: 'manifest-legacy-license',
  };
}

function readInstalledManifest(reference: InstalledPackageLegalReference): JsonRecord {
  const manifestPath = path.join(reference.installedRoot, 'package.json');
  const value: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isRecord(value)) throw new Error('安装 package.json 必须是对象');
  if (value.name !== reference.packageName || value.version !== reference.version) {
    throw new Error('安装 package.json 与 package identity 不一致');
  }
  return value;
}

function findExactVersion<T extends { packageName: string; version: string }>(
  collection: readonly T[],
  packageName: string,
  version: string
): T | undefined {
  return collection.find(item => item.packageName === packageName && item.version === version);
}

function findResolvedUnknownLicenseEvidence(
  reference: InstalledPackageLegalReference,
  unknownEvidence: readonly DependencyLicenseEvidence[]
): DependencyLicenseEvidence | undefined {
  return unknownEvidence.find(
    item =>
      item.packageName === reference.packageName &&
      item.versions.length === 1 &&
      item.versions[0] === reference.version &&
      item.disposition === 'resolved'
  );
}

function resolveLicenseDeclaration(input: {
  readonly manifest: JsonRecord;
  readonly reference: InstalledPackageLegalReference;
  readonly unknownEvidence: readonly DependencyLicenseEvidence[];
}): Readonly<{ declaration: LicenseDeclaration; unknownEvidence?: DependencyLicenseEvidence }> {
  if (input.reference.declaredLicense && input.reference.declaredLicense !== 'Unknown') {
    return {
      declaration: {
        expression: input.reference.declaredLicense,
        source: 'license-report',
      },
    };
  }
  if (input.reference.declaredLicense === undefined) {
    const manifestDeclaration = readManifestLicenseDeclaration(input.manifest);
    if (manifestDeclaration) return { declaration: manifestDeclaration };
  }
  const unknownEvidence = findResolvedUnknownLicenseEvidence(
    input.reference,
    input.unknownEvidence
  );
  if (!unknownEvidence?.license) throw new Error('存在未解除的 Unknown license');
  return {
    declaration: { expression: unknownEvidence.license, source: 'reviewed-evidence' },
    unknownEvidence,
  };
}

function resolveSelectedLicense(
  packageName: string,
  version: string,
  declaredLicense: string,
  selections: readonly DependencyLicenseSelection[]
): Readonly<{ expression: string; reason?: string }> | undefined {
  const selection = selections.find(
    item =>
      item.packageName === packageName &&
      item.version === version &&
      item.declaredExpression === declaredLicense
  );
  const needsSelection =
    /\s(?:AND|OR)\s/u.test(declaredLicense) || AMBIGUOUS_LICENSE_EXPRESSIONS.has(declaredLicense);
  if (!selection) return needsSelection ? undefined : { expression: declaredLicense };
  return {
    expression: selection.selectedExpression,
    ...(selection.reason ? { reason: selection.reason } : {}),
  };
}

function classifyStandardEvidenceFile(fileName: string): 'license' | 'notice' {
  return /^(?:copyright|notice|third[-_.]?party)/iu.test(fileName) ? 'notice' : 'license';
}

function findStandardEvidenceFiles(installedRoot: string): readonly string[] {
  return fs
    .readdirSync(installedRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && STANDARD_EVIDENCE_FILE_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readEvidenceFile(input: {
  readonly installedRoot: string;
  readonly kind: 'license' | 'metadata' | 'notice';
  readonly relativePath: string;
}): Readonly<{ descriptor: PackageLegalEvidenceFile; content?: string }> {
  const absolutePath = path.resolve(input.installedRoot, input.relativePath);
  if (!isPathInsideRoot(input.installedRoot, absolutePath)) {
    throw new Error(`evidence 路径越界：${input.relativePath}`);
  }
  const realInstalledRoot = fs.realpathSync(input.installedRoot);
  const realEvidencePath = fs.realpathSync(absolutePath);
  if (!isPathInsideRoot(realInstalledRoot, realEvidencePath)) {
    throw new Error(`evidence 符号链接目标越界：${input.relativePath}`);
  }
  const stat = fs.statSync(realEvidencePath);
  if (!stat.isFile()) throw new Error(`evidence 不是文件：${input.relativePath}`);
  const bytes = fs.readFileSync(realEvidencePath);
  if (bytes.includes(0)) throw new Error(`evidence 不是文本：${input.relativePath}`);
  const content = bytes.toString('utf8').trim();
  if (!content) throw new Error(`evidence 是空文件：${input.relativePath}`);
  return {
    descriptor: {
      kind: input.kind,
      origin: 'installed-package',
      relativePath: input.relativePath,
      sha256: sha256(bytes),
    },
    content: input.kind === 'metadata' ? undefined : content,
  };
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} 不是 SHA-256`);
}

function readReviewedEvidenceFile(input: {
  readonly evidence: ReviewedPackageLegalEvidence;
  readonly reference: InstalledPackageLegalReference;
  readonly reviewedEvidenceRootDir: string;
}): Readonly<{ content: string; descriptor: ReviewedPackageLegalEvidenceFile }> {
  const { evidence, reference } = input;
  assertSha256(evidence.contentSha256, 'reviewed evidence contentSha256');
  assertSha256(evidence.source.documentSha256, 'reviewed evidence source documentSha256');
  const absolutePath = path.resolve(input.reviewedEvidenceRootDir, evidence.evidencePath);
  if (!isPathInsideRoot(input.reviewedEvidenceRootDir, absolutePath)) {
    throw new Error(`reviewed evidence 路径越界：${evidence.evidencePath}`);
  }
  const realEvidenceRoot = fs.realpathSync(input.reviewedEvidenceRootDir);
  const realEvidencePath = fs.realpathSync(absolutePath);
  if (!isPathInsideRoot(realEvidenceRoot, realEvidencePath)) {
    throw new Error(`reviewed evidence 符号链接目标越界：${evidence.evidencePath}`);
  }
  const bytes = fs.readFileSync(realEvidencePath);
  if (bytes.includes(0)) throw new Error(`reviewed evidence 不是文本：${evidence.evidencePath}`);
  if (sha256(bytes) !== evidence.contentSha256) {
    throw new Error(`reviewed evidence 内容 hash 漂移：${evidence.evidencePath}`);
  }
  const content = bytes.toString('utf8').trim();
  if (!content) throw new Error(`reviewed evidence 是空文件：${evidence.evidencePath}`);

  if (evidence.source.kind === 'upstream-git-file') {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(evidence.source.repository)) {
      throw new Error('reviewed git evidence repository 不是规范 GitHub URL');
    }
    if (!/^[a-f0-9]{40}$/u.test(evidence.source.revision)) {
      throw new Error('reviewed git evidence revision 不是完整 commit SHA');
    }
    if (!evidence.source.url.includes(evidence.source.revision)) {
      throw new Error('reviewed git evidence URL 未锁定声明的 commit');
    }
  } else {
    const source = evidence.source;
    if (
      source.packageName !== reference.packageName ||
      source.version !== reference.version ||
      source.integrity !== reference.integrity
    ) {
      throw new Error('reviewed package excerpt 与当前 package identity/integrity 不一致');
    }
    if (
      !Number.isSafeInteger(source.startLine) ||
      !Number.isSafeInteger(source.endLine) ||
      source.startLine < 1 ||
      source.endLine < source.startLine
    ) {
      throw new Error('reviewed package excerpt 行范围无效');
    }
    const sourcePath = path.resolve(reference.installedRoot, source.packagePath);
    if (!isPathInsideRoot(reference.installedRoot, sourcePath)) {
      throw new Error('reviewed package excerpt 源路径越界');
    }
    const sourceBytes = fs.readFileSync(sourcePath);
    if (sha256(sourceBytes) !== source.documentSha256) {
      throw new Error('reviewed package excerpt 源文件 hash 漂移');
    }
    const sourceLines = sourceBytes.toString('utf8').split(/\r?\n/u);
    if (source.endLine > sourceLines.length) {
      throw new Error('reviewed package excerpt 行范围超出源文件');
    }
    const extracted = sourceLines
      .slice(source.startLine - 1, source.endLine)
      .join('\n')
      .trim();
    if (extracted !== content) {
      throw new Error('reviewed package excerpt 与锁定源文件片段不一致');
    }
  }

  return {
    content,
    descriptor: {
      kind: evidence.kind,
      origin: 'reviewed-upstream',
      relativePath: evidence.evidencePath,
      sha256: evidence.contentSha256,
      reason: evidence.reason,
      source: evidence.source,
    },
  };
}

function findReviewedEvidenceFiles(
  evidenceFiles: readonly ReviewedPackageLegalEvidence[],
  identity: string
): readonly ReviewedPackageLegalEvidence[] {
  return evidenceFiles.filter(item => item.appliesTo.includes(identity));
}

function comparePackageRecords(
  left: PackageLegalEvidenceRecord,
  right: PackageLegalEvidenceRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function collectPackageLegalEvidence(
  input: CollectPackageLegalEvidenceInput
): PackageLegalEvidenceResult {
  const problems: PackageLegalEvidenceResult['problems'][number][] = [];
  const packageRecords = new Map<string, PackageLegalEvidenceRecord>();
  const documentRecords = new Map<
    string,
    {
      appliesTo: Set<string>;
      content: string;
      fileNames: Set<string>;
      kind: 'license' | 'notice';
      sha256: string;
    }
  >();

  for (const evidence of input.reviewedEvidenceFiles) {
    if (evidence.appliesTo.length === 0) {
      problems.push({
        packageIdentity: '(reviewed-evidence)',
        message: `reviewed evidence 没有适用 package：${evidence.evidencePath}`,
      });
    }
    if (new Set(evidence.appliesTo).size !== evidence.appliesTo.length) {
      problems.push({
        packageIdentity: '(reviewed-evidence)',
        message: `reviewed evidence 存在重复 package：${evidence.evidencePath}`,
      });
    }
  }

  for (const reference of input.references) {
    const identity = packageIdentity(reference.packageName, reference.version);
    try {
      assertInstalledRootInside(input.rootDir, reference.installedRoot);
      const manifest = readInstalledManifest(reference);
      const { declaration, unknownEvidence } = resolveLicenseDeclaration({
        manifest,
        reference,
        unknownEvidence: input.unknownLicenseEvidence,
      });
      const selectedLicense = resolveSelectedLicense(
        reference.packageName,
        reference.version,
        declaration.expression,
        input.licenseSelections
      );
      if (!selectedLicense) {
        throw new Error(`许可证 ${declaration.expression} 缺少精确版本选择`);
      }
      if (input.requireIntegrity && !reference.integrity) {
        throw new Error('registry package 缺少 integrity');
      }
      if (
        unknownEvidence?.integrity !== undefined &&
        unknownEvidence.integrity !== reference.integrity
      ) {
        throw new Error('Unknown license evidence 的 registry integrity 与 lockfile 不一致');
      }
      const sourceOverride = findExactVersion(
        input.sourceOverrides,
        reference.packageName,
        reference.version
      );
      const source =
        readRepositorySource(manifest) ?? sourceOverride?.source ?? unknownEvidence?.source;
      if (!source) throw new Error('package manifest 缺少 source，且没有精确版本 override');

      const requestedEvidenceFiles = [
        ...findStandardEvidenceFiles(reference.installedRoot).map(relativePath => ({
          relativePath,
          kind: classifyStandardEvidenceFile(relativePath),
        })),
        ...input.supplementalEvidenceFiles
          .filter(
            item => item.packageName === reference.packageName && item.version === reference.version
          )
          .map(item => ({ relativePath: item.relativePath, kind: item.kind })),
      ];
      const seenEvidencePaths = new Set<string>();
      const evidenceFiles: PackageLegalEvidenceFile[] = [];
      for (const requested of requestedEvidenceFiles) {
        if (seenEvidencePaths.has(requested.relativePath)) continue;
        seenEvidencePaths.add(requested.relativePath);
        const evidence = readEvidenceFile({
          installedRoot: reference.installedRoot,
          relativePath: requested.relativePath,
          kind: requested.kind,
        });
        evidenceFiles.push(evidence.descriptor);
        if (evidence.content && requested.kind !== 'metadata') {
          const documentKey = `${requested.kind}:${evidence.descriptor.sha256}`;
          const document = documentRecords.get(documentKey) ?? {
            appliesTo: new Set<string>(),
            content: evidence.content,
            fileNames: new Set<string>(),
            kind: requested.kind,
            sha256: evidence.descriptor.sha256,
          };
          if (document.content !== evidence.content) throw new Error('evidence SHA-256 内容冲突');
          document.appliesTo.add(identity);
          document.fileNames.add(requested.relativePath);
          documentRecords.set(documentKey, document);
        }
      }
      for (const reviewedEvidence of findReviewedEvidenceFiles(
        input.reviewedEvidenceFiles,
        identity
      )) {
        if (reviewedEvidence.selectedLicense !== selectedLicense.expression) {
          throw new Error(
            `reviewed evidence 的许可证 ${reviewedEvidence.selectedLicense} 与选择 ${selectedLicense.expression} 不一致`
          );
        }
        if (seenEvidencePaths.has(reviewedEvidence.evidencePath)) continue;
        seenEvidencePaths.add(reviewedEvidence.evidencePath);
        const reviewed = readReviewedEvidenceFile({
          evidence: reviewedEvidence,
          reference,
          reviewedEvidenceRootDir: input.reviewedEvidenceRootDir,
        });
        evidenceFiles.push(reviewed.descriptor);
        const documentKey = `${reviewed.descriptor.kind}:${reviewed.descriptor.sha256}`;
        const document = documentRecords.get(documentKey) ?? {
          appliesTo: new Set<string>(),
          content: reviewed.content,
          fileNames: new Set<string>(),
          kind: reviewed.descriptor.kind,
          sha256: reviewed.descriptor.sha256,
        };
        if (document.content !== reviewed.content) {
          throw new Error('reviewed evidence SHA-256 内容冲突');
        }
        document.appliesTo.add(identity);
        document.fileNames.add(reviewed.descriptor.relativePath);
        documentRecords.set(documentKey, document);
      }
      evidenceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      if (
        unknownEvidence?.licenseFile &&
        !evidenceFiles.some(
          file =>
            file.relativePath === unknownEvidence.licenseFile?.relativePath &&
            file.sha256 === unknownEvidence.licenseFile.sha256
        )
      ) {
        throw new Error('Unknown license 的随包许可证 evidence 缺失或 hash 漂移');
      }
      const packageRecord: PackageLegalEvidenceRecord = {
        name: reference.packageName,
        version: reference.version,
        declaredLicense: declaration.expression,
        selectedLicense: selectedLicense.expression,
        ...(selectedLicense.reason ? { licenseConclusionReason: selectedLicense.reason } : {}),
        declarationSource: declaration.source,
        source,
        ...(reference.integrity ? { integrity: reference.integrity } : {}),
        evidence: evidenceFiles.some(item => item.kind !== 'metadata') ? 'files' : 'manifest-only',
        evidenceFiles,
      };
      const existing = packageRecords.get(identity);
      if (existing && !comparePackageRecords(existing, packageRecord)) {
        throw new Error('同一 package/version 的安装证据不一致');
      }
      packageRecords.set(identity, packageRecord);
    } catch (error) {
      problems.push({
        packageIdentity: identity,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sortedProblems = problems.sort(
    (left, right) =>
      left.packageIdentity.localeCompare(right.packageIdentity) ||
      left.message.localeCompare(right.message)
  );
  if (sortedProblems.length > 0) return { documents: [], packages: [], problems: sortedProblems };

  const packages = [...packageRecords.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  );
  const documents: PackageLegalDocument[] = [...documentRecords.values()]
    .map(document => ({
      appliesTo: [...document.appliesTo].sort((left, right) => left.localeCompare(right)),
      content: document.content,
      fileNames: [...document.fileNames].sort((left, right) => left.localeCompare(right)),
      kind: document.kind,
      sha256: document.sha256,
    }))
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256)
    );
  return { documents, packages, problems: [] };
}
