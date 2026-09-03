import type { BundleBuildTrace } from './bundleBuildTrace.mjs';

export interface BundleBuildTraceFile {
  readonly buildTarget: string;
  readonly fileName: string;
  readonly inputCount: number;
  readonly npmPackageCount: number;
  readonly outputCount: number;
  readonly sha256: string;
  readonly tool: BundleBuildTrace['tool'];
}

export interface BundleBuildTraceSet {
  readonly identity: Readonly<{
    readonly architecture: 'arm64' | 'x64';
    readonly platform: 'darwin' | 'win32';
  }>;
  readonly kind: 'linnya-bundle-build-trace-set';
  readonly limitations: readonly ['artifact-output-occurrences-not-yet-linked'];
  readonly schemaVersion: 1;
  readonly source: Readonly<{
    readonly dirty: boolean;
    readonly revision: string;
  }>;
  readonly summary: Readonly<{
    readonly buildTargetCount: number;
    readonly npmPackageCount: number;
    readonly outputCount: number;
    readonly traceFileCount: number;
  }>;
  readonly traces: readonly BundleBuildTraceFile[];
}

export function createBundleBuildTraceSet(input: {
  readonly identity: BundleBuildTraceSet['identity'];
  readonly requiredBuildTargets: readonly string[];
  readonly requiredBuildTargetPrefixes: readonly string[];
  readonly source: BundleBuildTraceSet['source'];
  readonly traceFiles: readonly {
    readonly fileName: string;
    readonly sha256: string;
    readonly trace: BundleBuildTrace;
  }[];
}): BundleBuildTraceSet;
