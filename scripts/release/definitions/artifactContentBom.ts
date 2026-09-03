export type ArtifactContentBomKind =
  | 'linnya-desktop-artifact-content'
  | 'linnya-plugin-artifact-content';

export type ArtifactContentCategory =
  | 'application-binary'
  | 'application-code'
  | 'application-resource'
  | 'bundled-runtime'
  | 'checksum'
  | 'electron-runtime'
  | 'legal-notice'
  | 'plugin-asset'
  | 'plugin-command-runtime'
  | 'plugin-backend-runtime'
  | 'plugin-manifest'
  | 'plugin-renderer-runtime'
  | 'plugin-resource'
  | 'production-dependency';

export type ArtifactContentScope = 'app-filesystem' | 'app-asar' | 'plugin-archive';

export interface ArtifactContentFileEntry {
  readonly category: ArtifactContentCategory;
  readonly executable: boolean;
  readonly path: string;
  readonly scope: ArtifactContentScope;
  readonly sha256: string;
  readonly size: number;
  readonly type: 'file';
}

export interface ArtifactContentSymlinkEntry {
  readonly category: ArtifactContentCategory;
  readonly path: string;
  readonly scope: ArtifactContentScope;
  readonly target: string;
  readonly type: 'symlink';
}

export type ArtifactContentEntry = ArtifactContentFileEntry | ArtifactContentSymlinkEntry;

export interface ArtifactEnvelopeDescriptor {
  readonly fileName: string;
  readonly role:
    | 'desktop-installer'
    | 'desktop-update-package'
    | 'plugin-archive'
    | 'release-blockmap'
    | 'release-metadata';
  readonly sha256: string;
  readonly sha512: string;
  readonly size: number;
}

export interface ArtifactSourceIdentity {
  readonly dirty: boolean;
  readonly revision: string;
}

export interface ArtifactBuildEnvironment {
  readonly architecture: string;
  readonly electronVersion?: string;
  readonly nodeVersion: string;
  readonly platform: string;
  /** Desktop 扁平依赖树的冻结输入；插件制品不使用该字段。 */
  readonly productionPackageLockSha256?: string;
}

export interface ArtifactContentIdentity {
  readonly architecture?: 'arm64' | 'x64';
  readonly name: string;
  readonly platform?: 'darwin' | 'win32';
  readonly pluginId?: string;
  readonly version: string;
}

export interface ArtifactContentSummary {
  readonly fileCount: number;
  readonly fileSize: number;
  readonly scopeCounts: Readonly<Record<ArtifactContentScope, number>>;
  readonly symlinkCount: number;
  readonly treeSha256: string;
}

export interface ArtifactContentBom {
  readonly artifacts: readonly ArtifactEnvelopeDescriptor[];
  readonly entries: readonly ArtifactContentEntry[];
  readonly environment: ArtifactBuildEnvironment;
  readonly identity: ArtifactContentIdentity;
  readonly kind: ArtifactContentBomKind;
  readonly schemaVersion: 1;
  readonly source: ArtifactSourceIdentity;
  readonly summary: ArtifactContentSummary;
}
