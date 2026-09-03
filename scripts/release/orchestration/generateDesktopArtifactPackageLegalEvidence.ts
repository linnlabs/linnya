import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ROOT_DEPENDENCY_LICENSE_EVIDENCE } from '../definitions/dependencyLicenseEvidence';
import {
  DEPENDENCY_LICENSE_SELECTIONS,
  DEPENDENCY_SOURCE_OVERRIDES,
  DEPENDENCY_SUPPLEMENTAL_EVIDENCE_FILES,
} from '../definitions/dependencyLegalPolicy';
import type { ArtifactBundleComponentMap } from '../definitions/artifactBundleComponentMap';
import {
  LINNYA_FIRST_PARTY_WORKSPACE_PACKAGE_NAMES,
  type ArtifactPackageLegalEvidence,
} from '../definitions/artifactPackageLegalEvidence';
import type { ArtifactPackageMap } from '../definitions/artifactPackageMap';
import { REVIEWED_PACKAGE_LEGAL_EVIDENCE } from '../definitions/reviewedPackageLegalEvidence';
import { createArtifactPackageLegalEvidence } from '../functions/artifactPackageLegalEvidence';
import { resolveDesktopArtifactPaths } from '../functions/desktopArtifactPaths';

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isArtifactPackageMap(value: unknown): value is ArtifactPackageMap {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'linnya-desktop-artifact-package-map' ||
    !isRecord(value.identity) ||
    !isRecord(value.source) ||
    !isRecord(value.environment) ||
    !isRecord(value.summary) ||
    typeof value.contentBomSha256 !== 'string' ||
    typeof value.contentTreeSha256 !== 'string' ||
    typeof value.productionPackageLockSha256 !== 'string' ||
    !Array.isArray(value.components) ||
    !Array.isArray(value.limitations)
  ) {
    return false;
  }
  const validComponents = value.components.every(
    component =>
      isRecord(component) &&
      typeof component.id === 'string' &&
      (component.installKind === 'registry' || component.installKind === 'workspace') &&
      typeof component.name === 'string' &&
      typeof component.version === 'string' &&
      isStringArray(component.integrities) &&
      isStringArray(component.resolved) &&
      isStringArray(component.lockLocations) &&
      Array.isArray(component.locations) &&
      (component.artifactDeclaredLicense === undefined ||
        typeof component.artifactDeclaredLicense === 'string')
  );
  const validLimitations = value.limitations.every(
    limitation =>
      isRecord(limitation) &&
      (limitation.code === 'compiled-bundle-inputs-not-attributed' ||
        limitation.code === 'license-evidence-not-attached' ||
        limitation.code === 'non-npm-runtime-components-not-attributed') &&
      typeof limitation.entryCount === 'number' &&
      isStringArray(limitation.pathSamples)
  );
  return validComponents && validLimitations;
}

function isArtifactBundleComponentMap(value: unknown): value is ArtifactBundleComponentMap {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.kind === 'linnya-desktop-artifact-bundle-component-map'
    && typeof value.contentTreeSha256 === 'string'
    && isRecord(value.identity)
    && isRecord(value.source)
    && isRecord(value.environment)
    && isRecord(value.summary)
    && Array.isArray(value.components)
    && Array.isArray(value.occurrences)
    && Array.isArray(value.limitations);
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeOrVerify(input: {
  readonly evidence: ArtifactPackageLegalEvidence;
  readonly evidencePath: string;
  readonly notice: string;
  readonly noticePath: string;
  readonly verify: boolean;
}): void {
  const renderedEvidence = `${JSON.stringify(input.evidence, null, 2)}\n`;
  if (input.verify) {
    if (
      fs.readFileSync(input.evidencePath, 'utf8') !== renderedEvidence ||
      fs.readFileSync(input.noticePath, 'utf8') !== input.notice
    ) {
      throw new Error('Desktop package 法律 evidence 与当前产物不一致');
    }
    return;
  }
  fs.writeFileSync(input.evidencePath, renderedEvidence, 'utf8');
  fs.writeFileSync(input.noticePath, input.notice, 'utf8');
}

export function generateDesktopArtifactPackageLegalEvidence(input: {
  readonly architecture: 'arm64' | 'x64';
  readonly platform: 'darwin' | 'win32';
  readonly rootDir: string;
  readonly verify: boolean;
}): Readonly<{ evidencePath: string; noticePath: string }> {
  const paths = resolveDesktopArtifactPaths(input);
  const packageMapPath = path.join(paths.outputRoot, `${paths.evidenceBaseName}.package-map.json`);
  const bundleMapPath = path.join(
    paths.outputRoot,
    `${paths.evidenceBaseName}.bundle-component-map.json`
  );
  const packageMapBytes = fs.readFileSync(packageMapPath);
  const packageMapValue: unknown = JSON.parse(packageMapBytes.toString('utf8'));
  if (!isArtifactPackageMap(packageMapValue)) {
    throw new Error(`Desktop package map 合同无效：${packageMapPath}`);
  }
  const bundleMapBytes = fs.readFileSync(bundleMapPath);
  const bundleMapValue: unknown = JSON.parse(bundleMapBytes.toString('utf8'));
  if (!isArtifactBundleComponentMap(bundleMapValue)) {
    throw new Error(`Desktop bundle component map 合同无效：${bundleMapPath}`);
  }
  const productionLockBytes = fs.readFileSync(
    path.join(input.rootDir, 'production-package-lock.json')
  );
  if (sha256(productionLockBytes) !== packageMapValue.productionPackageLockSha256) {
    throw new Error('Desktop package map 与当前 production lock hash 不一致');
  }
  const result = createArtifactPackageLegalEvidence({
    bundleComponentMap: bundleMapValue,
    bundleComponentMapSha256: sha256(bundleMapBytes),
    packageMap: packageMapValue,
    packageMapSha256: sha256(packageMapBytes),
    productionInstallRoot: path.join(input.rootDir, 'dist_build'),
    firstPartyWorkspacePackageNames: LINNYA_FIRST_PARTY_WORKSPACE_PACKAGE_NAMES,
    licenseSelections: DEPENDENCY_LICENSE_SELECTIONS,
    sourceOverrides: DEPENDENCY_SOURCE_OVERRIDES,
    supplementalEvidenceFiles: DEPENDENCY_SUPPLEMENTAL_EVIDENCE_FILES,
    unknownLicenseEvidence: ROOT_DEPENDENCY_LICENSE_EVIDENCE,
    reviewedEvidenceFiles: REVIEWED_PACKAGE_LEGAL_EVIDENCE,
    reviewedEvidenceRootDir: input.rootDir,
  });
  if (!result.evidence || !result.notice || result.problems.length > 0) {
    const details = result.problems
      .map(problem => `- ${problem.packageIdentity}: ${problem.message}`)
      .join('\n');
    throw new Error(`Desktop package 法律 evidence 生成失败：\n${details}`);
  }
  const evidencePath = path.join(
    paths.outputRoot,
    `${paths.evidenceBaseName}.package-legal-evidence.json`
  );
  const noticePath = path.join(
    paths.outputRoot,
    `${paths.evidenceBaseName}.package-third-party-notices.txt`
  );
  writeOrVerify({
    evidence: result.evidence,
    evidencePath,
    notice: result.notice,
    noticePath,
    verify: input.verify,
  });
  return { evidencePath, noticePath };
}

function readCliValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function main(): void {
  const platform = readCliValue('platform');
  const architecture = readCliValue('architecture');
  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    throw new Error(
      '用法：generateDesktopArtifactPackageLegalEvidence.ts --platform=<darwin|win32> --architecture=<arm64|x64> [--verify]'
    );
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const output = generateDesktopArtifactPackageLegalEvidence({
    rootDir,
    platform,
    architecture,
    verify: process.argv.includes('--verify'),
  });
  process.stdout.write(
    `[desktop-package-legal-evidence] ${path.relative(rootDir, output.evidencePath)}\n` +
      `[desktop-package-legal-evidence] ${path.relative(rootDir, output.noticePath)}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
