import type {
  ArtifactBuildEnvironment,
  ArtifactContentIdentity,
  ArtifactSourceIdentity,
} from './artifactContentBom';

export interface ArtifactBundleOccurrence {
  readonly artifactPath: string;
  readonly artifactScope: 'app-asar' | 'app-filesystem';
  readonly buildTarget: string;
  readonly inputAttribution:
    | 'build-graph'
    | 'build-wide'
    | 'derived-output'
    | 'module-contribution';
  readonly sha256: string;
  readonly traceFileName: string;
  readonly traceOutputPath: string;
}

export interface ArtifactBundleNpmComponent {
  readonly buildTargets: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface ArtifactBundleComponentMapLimitation {
  readonly code:
    | 'bundle-package-legal-evidence-not-attached'
    | 'non-bundle-code-artifact-not-attributed'
    | 'trace-output-not-distributed-or-used-as-intermediate';
  readonly entryCount: number;
  readonly pathSamples: readonly string[];
}

export interface ArtifactBundleComponentMap {
  readonly bundleTraceSetSha256: string;
  readonly components: readonly ArtifactBundleNpmComponent[];
  readonly contentBomSha256: string;
  readonly contentTreeSha256: string;
  readonly environment: ArtifactBuildEnvironment;
  readonly identity: ArtifactContentIdentity;
  readonly kind: 'linnya-desktop-artifact-bundle-component-map';
  readonly limitations: readonly ArtifactBundleComponentMapLimitation[];
  readonly occurrences: readonly ArtifactBundleOccurrence[];
  readonly schemaVersion: 1;
  readonly source: ArtifactSourceIdentity;
  readonly summary: Readonly<{
    readonly artifactOccurrenceCount: number;
    readonly buildTargetCount: number;
    readonly intermediateOutputCount: number;
    readonly npmPackageComponentCount: number;
    readonly traceOutputCount: number;
  }>;
}
