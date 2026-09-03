import type {
  ArtifactBuildEnvironment,
  ArtifactContentIdentity,
  ArtifactSourceIdentity,
} from './artifactContentBom';
import type {
  PackageLegalEvidenceFile,
  PackageLicenseDeclarationSource,
} from './packageLegalEvidence';

export const LINNYA_FIRST_PARTY_WORKSPACE_PACKAGE_NAMES = ['@app/schemas'] as const;

export interface ArtifactFirstPartyPackageLegalEvidence {
  readonly artifactDeclaredLicense?: string;
  readonly componentId: string;
  readonly licenseState: 'declared' | 'project-license-pending';
  readonly name: string;
  readonly version: string;
}

export interface ArtifactThirdPartyPackageLegalEvidence {
  readonly componentId: string;
  readonly declaredLicense: string;
  readonly declarationSource: PackageLicenseDeclarationSource;
  readonly evidence: 'files' | 'manifest-only';
  readonly evidenceFiles: readonly PackageLegalEvidenceFile[];
  readonly integrity: string;
  readonly licenseConclusionReason?: string;
  readonly name: string;
  readonly selectedLicense: string;
  readonly source: string;
  readonly version: string;
}

export interface ArtifactPackageLegalEvidenceLimitation {
  readonly code:
    | 'bundle-package-legal-evidence-not-attached'
    | 'first-party-package-license-not-declared'
    | 'manifest-only-third-party-license-evidence'
    | 'non-bundle-code-artifact-not-attributed'
    | 'non-npm-runtime-components-not-attributed'
    | 'trace-output-not-distributed-or-used-as-intermediate';
  readonly entryCount: number;
  readonly pathSamples: readonly string[];
}

export interface ArtifactPackageLegalEvidence {
  readonly bundleComponentMapSha256: string;
  readonly contentTreeSha256: string;
  readonly environment: ArtifactBuildEnvironment;
  readonly firstPartyComponents: readonly ArtifactFirstPartyPackageLegalEvidence[];
  readonly identity: ArtifactContentIdentity;
  readonly kind: 'linnya-desktop-artifact-package-legal-evidence';
  readonly licenseDocuments: readonly {
    readonly appliesTo: readonly string[];
    readonly fileNames: readonly string[];
    readonly kind: 'license' | 'notice';
    readonly sha256: string;
  }[];
  readonly limitations: readonly ArtifactPackageLegalEvidenceLimitation[];
  readonly packageMapSha256: string;
  readonly productionPackageLockSha256: string;
  readonly schemaVersion: 3;
  readonly source: ArtifactSourceIdentity;
  readonly summary: Readonly<{
    artifactPackageComponentCount: number;
    bundlePackageComponentCount: number;
    firstPartyPackageCount: number;
    licenseDocumentCount: number;
    manifestOnlyThirdPartyPackageCount: number;
    thirdPartyPackageCount: number;
  }>;
  readonly thirdPartyComponents: readonly ArtifactThirdPartyPackageLegalEvidence[];
}
