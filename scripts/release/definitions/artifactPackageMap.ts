import type {
  ArtifactBuildEnvironment,
  ArtifactContentIdentity,
  ArtifactSourceIdentity,
} from './artifactContentBom';

export interface ArtifactPackageLocation {
  /** electron-builder 最终写入 app.asar 的逻辑 package 根。 */
  readonly asarPath: string;
  readonly asarEntryCount: number;
  readonly packageJsonSha256: string;
  /** asarUnpack 生成的物理副本；没有解包内容时为空。 */
  readonly unpackedEntryCount: number;
  readonly unpackedPath?: string;
}

export interface ArtifactPackageComponent {
  readonly artifactDeclaredLicense?: string;
  readonly id: string;
  readonly installKind: 'registry' | 'workspace';
  readonly integrities: readonly string[];
  readonly locations: readonly ArtifactPackageLocation[];
  /** npm lock 中的安装位置；打包器可以重排位置，但不能改变 package identity。 */
  readonly lockLocations: readonly string[];
  readonly name: string;
  readonly resolved: readonly string[];
  readonly version: string;
}

export interface ArtifactPackageMapLimitation {
  readonly code:
    | 'compiled-bundle-inputs-not-attributed'
    | 'license-evidence-not-attached'
    | 'non-npm-runtime-components-not-attributed';
  readonly entryCount: number;
  readonly pathSamples: readonly string[];
}

export interface ArtifactPackageMap {
  readonly components: readonly ArtifactPackageComponent[];
  readonly contentBomSha256: string;
  readonly contentTreeSha256: string;
  readonly environment: ArtifactBuildEnvironment;
  readonly identity: ArtifactContentIdentity;
  readonly kind: 'linnya-desktop-artifact-package-map';
  readonly limitations: readonly ArtifactPackageMapLimitation[];
  readonly productionPackageLockSha256: string;
  readonly schemaVersion: 1;
  readonly source: ArtifactSourceIdentity;
  readonly summary: Readonly<{
    asarPackageEntryCount: number;
    packageComponentCount: number;
    packageLocationCount: number;
    unpackedPackageEntryCount: number;
  }>;
}
