import fs from 'node:fs';
import path from 'node:path';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';
import type { ArtifactBundleComponentMap } from '../definitions/artifactBundleComponentMap';
import type {
  ArtifactFirstPartyPackageLegalEvidence,
  ArtifactPackageLegalEvidence,
  ArtifactPackageLegalEvidenceLimitation,
  ArtifactThirdPartyPackageLegalEvidence,
} from '../definitions/artifactPackageLegalEvidence';
import type {
  ArtifactPackageComponent,
  ArtifactPackageMap,
} from '../definitions/artifactPackageMap';
import type {
  DependencyLicenseSelection,
  DependencySourceOverride,
  DependencySupplementalEvidenceFile,
  InstalledPackageLegalReference,
  PackageLegalDocument,
  ReviewedPackageLegalEvidence,
} from '../definitions/packageLegalEvidence';
import {
  collectPackageLegalEvidence,
  packageIdentity,
  readManifestLicenseDeclaration,
} from './packageLegalEvidence';

export interface ArtifactPackageLegalEvidenceProblem {
  readonly packageIdentity: string;
  readonly message: string;
}

export interface ArtifactPackageLegalEvidenceResult {
  readonly evidence?: ArtifactPackageLegalEvidence;
  readonly notice?: string;
  readonly problems: readonly ArtifactPackageLegalEvidenceProblem[];
}

export interface CreateArtifactPackageLegalEvidenceInput {
  readonly bundleComponentMap: ArtifactBundleComponentMap;
  readonly bundleComponentMapSha256: string;
  readonly firstPartyWorkspacePackageNames: readonly string[];
  readonly licenseSelections: readonly DependencyLicenseSelection[];
  readonly packageMap: ArtifactPackageMap;
  readonly packageMapSha256: string;
  readonly productionInstallRoot: string;
  readonly reviewedEvidenceFiles: readonly ReviewedPackageLegalEvidence[];
  readonly reviewedEvidenceRootDir: string;
  readonly sourceOverrides: readonly DependencySourceOverride[];
  readonly supplementalEvidenceFiles: readonly DependencySupplementalEvidenceFile[];
  readonly unknownLicenseEvidence: readonly DependencyLicenseEvidence[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(rootDir, targetPath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveInstalledRoots(
  productionInstallRoot: string,
  component: ArtifactPackageComponent
): readonly string[] {
  const roots = new Map<string, string>();
  for (const lockLocation of component.lockLocations) {
    const installedRoot = path.resolve(productionInstallRoot, lockLocation);
    if (!isPathInsideRoot(productionInstallRoot, installedRoot)) {
      throw new Error(`production lock location 越界：${lockLocation}`);
    }
    if (!fs.existsSync(path.join(installedRoot, 'package.json'))) continue;
    roots.set(fs.realpathSync(installedRoot), installedRoot);
  }
  if (roots.size === 0) throw new Error('冻结 production install 中找不到 package manifest');
  return [...roots.values()].sort((left, right) => left.localeCompare(right));
}

function readFirstPartyEvidence(input: {
  readonly component: ArtifactPackageComponent;
  readonly installedRoot: string;
}): ArtifactFirstPartyPackageLegalEvidence {
  const manifestValue: unknown = JSON.parse(
    fs.readFileSync(path.join(input.installedRoot, 'package.json'), 'utf8')
  );
  if (
    typeof manifestValue !== 'object' ||
    manifestValue === null ||
    Array.isArray(manifestValue) ||
    !('name' in manifestValue) ||
    !('version' in manifestValue) ||
    manifestValue.name !== input.component.name ||
    manifestValue.version !== input.component.version
  ) {
    throw new Error('first-party 安装 manifest 与 artifact component 不一致');
  }
  const declaration = readManifestLicenseDeclaration(manifestValue);
  if (
    input.component.artifactDeclaredLicense &&
    declaration?.expression !== input.component.artifactDeclaredLicense
  ) {
    throw new Error('first-party artifact/安装 manifest 的 license 不一致');
  }
  return {
    componentId: input.component.id,
    name: input.component.name,
    version: input.component.version,
    licenseState: declaration ? 'declared' : 'project-license-pending',
    ...(declaration ? { artifactDeclaredLicense: declaration.expression } : {}),
  };
}

function createLimitations(input: {
  readonly bundleMap: ArtifactBundleComponentMap;
  readonly firstPartyComponents: readonly ArtifactFirstPartyPackageLegalEvidence[];
  readonly map: ArtifactPackageMap;
  readonly thirdPartyComponents: readonly ArtifactThirdPartyPackageLegalEvidence[];
}): readonly ArtifactPackageLegalEvidenceLimitation[] {
  const carriedLimitations: ArtifactPackageLegalEvidenceLimitation[] =
    input.map.limitations.flatMap(item =>
      item.code === 'license-evidence-not-attached' || item.code === 'compiled-bundle-inputs-not-attributed'
        ? []
        : [
            {
              code: item.code,
              entryCount: item.entryCount,
              pathSamples: item.pathSamples,
            },
          ]
    );
  const bundleLimitations: ArtifactPackageLegalEvidenceLimitation[] =
    input.bundleMap.limitations.map(limitation => ({
      code: limitation.code,
      entryCount: limitation.entryCount,
      pathSamples: limitation.pathSamples,
    }));
  const pendingFirstParty = input.firstPartyComponents.filter(
    item => item.licenseState === 'project-license-pending'
  );
  const manifestOnly = input.thirdPartyComponents.filter(item => item.evidence === 'manifest-only');
  return [
    ...carriedLimitations,
    ...bundleLimitations,
    ...(pendingFirstParty.length > 0
      ? [
          {
            code: 'first-party-package-license-not-declared' as const,
            entryCount: pendingFirstParty.length,
            pathSamples: pendingFirstParty.map(item => item.componentId),
          },
        ]
      : []),
    ...(manifestOnly.length > 0
      ? [
          {
            code: 'manifest-only-third-party-license-evidence' as const,
            entryCount: manifestOnly.length,
            pathSamples: manifestOnly.slice(0, 12).map(item => item.componentId),
          },
        ]
      : []),
  ];
}

function renderNotice(input: {
  readonly documents: readonly PackageLegalDocument[];
  readonly evidence: ArtifactPackageLegalEvidence;
}): string {
  const manifestOnly = input.evidence.thirdPartyComponents.filter(
    item => item.evidence === 'manifest-only'
  );
  const lines = [
    'LINNYA DESKTOP PACKAGED NPM THIRD-PARTY NOTICE',
    '',
    `Project: ${input.evidence.identity.name}@${input.evidence.identity.version}`,
    `Target: ${input.evidence.environment.platform}/${input.evidence.environment.architecture}`,
    `Artifact content tree: ${input.evidence.contentTreeSha256}`,
    '',
    'Scope: unbundled npm package components physically present in the packaged application.',
    'Bundle inputs are mapped separately, but their legal evidence, Electron, and separately bundled native runtimes remain outside this notice.',
    '',
    'PACKAGES',
    '',
    ...input.evidence.thirdPartyComponents.map(item => {
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
    'LICENSE, COPYRIGHT, AND NOTICE TEXTS',
    '',
  ];
  for (const document of input.documents) {
    lines.push(
      `----- ${document.kind.toUpperCase()} ${document.sha256} -----`,
      `Applies to: ${document.appliesTo.join(', ')}`,
      `Installed file names: ${document.fileNames.join(', ')}`,
      '',
      document.content,
      ''
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function createArtifactPackageLegalEvidence(
  input: CreateArtifactPackageLegalEvidenceInput
): ArtifactPackageLegalEvidenceResult {
  if (!SHA256_PATTERN.test(input.packageMapSha256)) {
    return {
      problems: [{ packageIdentity: '(input)', message: 'package map SHA-256 无效' }],
    };
  }
  if (
    !SHA256_PATTERN.test(input.bundleComponentMapSha256)
    || input.bundleComponentMap.contentTreeSha256 !== input.packageMap.contentTreeSha256
    || input.bundleComponentMap.identity.name !== input.packageMap.identity.name
    || input.bundleComponentMap.identity.version !== input.packageMap.identity.version
  ) {
    return {
      problems: [{ packageIdentity: '(input)', message: 'bundle component map 与 package map 不一致' }],
    };
  }
  const firstPartyNames = new Set(input.firstPartyWorkspacePackageNames);
  const firstPartyComponents: ArtifactFirstPartyPackageLegalEvidence[] = [];
  const thirdPartyComponents = input.packageMap.components.filter(
    component => component.installKind === 'registry'
  );
  const problems: ArtifactPackageLegalEvidenceProblem[] = [];
  const references: InstalledPackageLegalReference[] = [];

  for (const component of input.packageMap.components) {
    const identity = packageIdentity(component.name, component.version);
    try {
      const installedRoots = resolveInstalledRoots(input.productionInstallRoot, component);
      if (component.installKind === 'workspace') {
        if (!firstPartyNames.has(component.name)) {
          throw new Error('出现未登记的 first-party workspace package');
        }
        const installedRoot = installedRoots[0];
        if (!installedRoot) throw new Error('first-party package 没有安装根');
        firstPartyComponents.push(readFirstPartyEvidence({ component, installedRoot }));
        continue;
      }
      if (component.integrities.length !== 1) {
        throw new Error('registry artifact component 缺少唯一 integrity');
      }
      for (const installedRoot of installedRoots) {
        references.push({
          packageName: component.name,
          version: component.version,
          installedRoot,
          integrity: component.integrities[0],
        });
      }
    } catch (error) {
      problems.push({
        packageIdentity: identity,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (problems.length > 0) {
    return {
      problems: problems.sort((left, right) =>
        left.packageIdentity.localeCompare(right.packageIdentity)
      ),
    };
  }

  const legalEvidence = collectPackageLegalEvidence({
    rootDir: input.productionInstallRoot,
    references,
    requireIntegrity: true,
    licenseSelections: input.licenseSelections,
    sourceOverrides: input.sourceOverrides,
    supplementalEvidenceFiles: input.supplementalEvidenceFiles,
    unknownLicenseEvidence: input.unknownLicenseEvidence,
    reviewedEvidenceFiles: input.reviewedEvidenceFiles,
    reviewedEvidenceRootDir: input.reviewedEvidenceRootDir,
  });
  if (legalEvidence.problems.length > 0) return { problems: legalEvidence.problems };

  const packageEvidenceByIdentity = new Map(
    legalEvidence.packages.map(item => [packageIdentity(item.name, item.version), item])
  );
  const attachedThirdPartyComponents: ArtifactThirdPartyPackageLegalEvidence[] = [];
  for (const component of thirdPartyComponents) {
    const identity = packageIdentity(component.name, component.version);
    const packageEvidence = packageEvidenceByIdentity.get(identity);
    if (!packageEvidence?.integrity) {
      problems.push({ packageIdentity: identity, message: 'artifact component 缺少法律 evidence' });
      continue;
    }
    if (
      component.artifactDeclaredLicense &&
      component.artifactDeclaredLicense !== packageEvidence.declaredLicense
    ) {
      problems.push({
        packageIdentity: identity,
        message: 'artifact/安装 manifest 的 license declaration 不一致',
      });
      continue;
    }
    attachedThirdPartyComponents.push({
      componentId: component.id,
      name: packageEvidence.name,
      version: packageEvidence.version,
      declaredLicense: packageEvidence.declaredLicense,
      selectedLicense: packageEvidence.selectedLicense,
      declarationSource: packageEvidence.declarationSource,
      source: packageEvidence.source,
      integrity: packageEvidence.integrity,
      ...(packageEvidence.licenseConclusionReason
        ? { licenseConclusionReason: packageEvidence.licenseConclusionReason }
        : {}),
      evidence: packageEvidence.evidence,
      evidenceFiles: packageEvidence.evidenceFiles,
    });
  }
  if (problems.length > 0) return { problems };

  firstPartyComponents.sort((left, right) => left.componentId.localeCompare(right.componentId));
  attachedThirdPartyComponents.sort((left, right) =>
    left.componentId.localeCompare(right.componentId)
  );
  const evidence: ArtifactPackageLegalEvidence = {
    schemaVersion: 3,
    kind: 'linnya-desktop-artifact-package-legal-evidence',
    identity: input.packageMap.identity,
    source: input.packageMap.source,
    environment: input.packageMap.environment,
    contentTreeSha256: input.packageMap.contentTreeSha256,
    productionPackageLockSha256: input.packageMap.productionPackageLockSha256,
    packageMapSha256: input.packageMapSha256,
    bundleComponentMapSha256: input.bundleComponentMapSha256,
    summary: {
      artifactPackageComponentCount: input.packageMap.components.length,
      bundlePackageComponentCount: input.bundleComponentMap.components.length,
      firstPartyPackageCount: firstPartyComponents.length,
      thirdPartyPackageCount: attachedThirdPartyComponents.length,
      manifestOnlyThirdPartyPackageCount: attachedThirdPartyComponents.filter(
        item => item.evidence === 'manifest-only'
      ).length,
      licenseDocumentCount: legalEvidence.documents.length,
    },
    firstPartyComponents,
    thirdPartyComponents: attachedThirdPartyComponents,
    licenseDocuments: legalEvidence.documents.map(({ content: _content, ...document }) => document),
    limitations: createLimitations({
      bundleMap: input.bundleComponentMap,
      map: input.packageMap,
      firstPartyComponents,
      thirdPartyComponents: attachedThirdPartyComponents,
    }),
  };
  return {
    evidence,
    notice: renderNotice({ evidence, documents: legalEvidence.documents }),
    problems: [],
  };
}
