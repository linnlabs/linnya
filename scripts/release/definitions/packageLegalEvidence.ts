import type { DependencyLicenseEvidence } from './dependencyLicenseEvidence';

export interface DependencyLicenseSelection {
  readonly packageName: string;
  readonly version: string;
  readonly declaredExpression: string;
  readonly selectedExpression: string;
  readonly reason?: string;
}

export interface DependencySourceOverride {
  readonly packageName: string;
  readonly version: string;
  readonly source: string;
  readonly reason: string;
}

export interface DependencySupplementalEvidenceFile {
  readonly packageName: string;
  readonly version: string;
  readonly relativePath: string;
  readonly kind: 'metadata' | 'notice';
  readonly reason: string;
}

export type PackageLicenseDeclarationSource =
  | 'license-report'
  | 'manifest-legacy-license'
  | 'manifest-license'
  | 'reviewed-evidence';

export interface InstalledPackageLegalReference {
  readonly declaredLicense?: string;
  readonly installedRoot: string;
  readonly integrity?: string;
  readonly packageName: string;
  readonly version: string;
}

export interface InstalledPackageLegalEvidenceFile {
  readonly kind: 'license' | 'metadata' | 'notice';
  readonly origin: 'installed-package';
  readonly relativePath: string;
  readonly sha256: string;
}

export interface ReviewedGitLegalEvidenceSource {
  readonly documentSha256: string;
  readonly kind: 'upstream-git-file';
  readonly repository: string;
  readonly repositoryPath: string;
  readonly revision: string;
  readonly url: string;
}

export interface ReviewedInstalledPackageExcerptSource {
  readonly documentSha256: string;
  readonly endLine: number;
  readonly integrity: string;
  readonly kind: 'installed-package-file-excerpt';
  readonly packageName: string;
  readonly packagePath: string;
  readonly startLine: number;
  readonly version: string;
}

export type ReviewedLegalEvidenceSource =
  | ReviewedGitLegalEvidenceSource
  | ReviewedInstalledPackageExcerptSource;

export interface ReviewedPackageLegalEvidence {
  readonly appliesTo: readonly string[];
  readonly contentSha256: string;
  readonly evidencePath: string;
  readonly kind: 'license' | 'notice';
  readonly reason: string;
  readonly selectedLicense: string;
  readonly source: ReviewedLegalEvidenceSource;
}

export interface ReviewedPackageLegalEvidenceFile {
  readonly kind: 'license' | 'notice';
  readonly origin: 'reviewed-upstream';
  readonly reason: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly source: ReviewedLegalEvidenceSource;
}

export type PackageLegalEvidenceFile =
  | InstalledPackageLegalEvidenceFile
  | ReviewedPackageLegalEvidenceFile;

export interface PackageLegalEvidenceRecord {
  readonly declaredLicense: string;
  readonly declarationSource: PackageLicenseDeclarationSource;
  readonly evidence: 'files' | 'manifest-only';
  readonly evidenceFiles: readonly PackageLegalEvidenceFile[];
  readonly integrity?: string;
  readonly licenseConclusionReason?: string;
  readonly name: string;
  readonly selectedLicense: string;
  readonly source: string;
  readonly version: string;
}

export interface PackageLegalDocument {
  readonly appliesTo: readonly string[];
  readonly content: string;
  readonly fileNames: readonly string[];
  readonly kind: 'license' | 'notice';
  readonly sha256: string;
}

export interface PackageLegalEvidenceProblem {
  readonly packageIdentity: string;
  readonly message: string;
}

export interface CollectPackageLegalEvidenceInput {
  readonly licenseSelections: readonly DependencyLicenseSelection[];
  readonly references: readonly InstalledPackageLegalReference[];
  readonly reviewedEvidenceFiles: readonly ReviewedPackageLegalEvidence[];
  readonly reviewedEvidenceRootDir: string;
  readonly requireIntegrity: boolean;
  readonly rootDir: string;
  readonly sourceOverrides: readonly DependencySourceOverride[];
  readonly supplementalEvidenceFiles: readonly DependencySupplementalEvidenceFile[];
  readonly unknownLicenseEvidence: readonly DependencyLicenseEvidence[];
}

export interface PackageLegalEvidenceResult {
  readonly documents: readonly PackageLegalDocument[];
  readonly packages: readonly PackageLegalEvidenceRecord[];
  readonly problems: readonly PackageLegalEvidenceProblem[];
}
