export interface ReleasePackageInfo {
  readonly version: string;
  readonly productName: string;
  readonly publishUrl: string;
}

export interface ReleaseNotesInfo {
  readonly title: string;
  readonly version: string;
  readonly notes: readonly string[];
  readonly rawMarkdown: string;
}

export interface ReleaseArtifactNames {
  readonly macDmg: string;
  readonly macZip: string;
  readonly macZipBlockmap: string;
  readonly macLatestYml: string;
  readonly winInstaller: string;
  readonly winInstallerBlockmap: string;
  readonly winLatestYml: string;
}

export interface ReleaseValidationProblem {
  readonly path: string;
  readonly message: string;
}

export interface ReleaseValidationResult {
  readonly ok: boolean;
  readonly version: string;
  readonly problems: readonly ReleaseValidationProblem[];
}
