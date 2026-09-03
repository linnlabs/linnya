export type BundleBuildTraceTool = 'bytenode' | 'esbuild' | 'tsup' | 'vite-rollup';

export interface BundleBuildTraceInput {
  readonly id: string;
  readonly kind:
    | 'bundle-output'
    | 'external-source'
    | 'npm-package'
    | 'virtual'
    | 'workspace-source';
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly path: string;
  readonly sha256?: string;
  readonly size?: number;
}

export interface BundleBuildTraceInputContribution {
  readonly bytesInOutput?: number;
  readonly inputId: string;
}

export interface BundleBuildTraceExternalImport {
  readonly kind: string;
  readonly path: string;
}

export interface BundleBuildTraceOutput {
  readonly entryPoint?: string;
  readonly externalImports: readonly BundleBuildTraceExternalImport[];
  readonly inputAttribution:
    | 'build-graph'
    | 'build-wide'
    | 'derived-output'
    | 'module-contribution';
  readonly inputs: readonly BundleBuildTraceInputContribution[];
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly type: 'asset' | 'chunk';
}

export interface BundleBuildTrace {
  readonly buildInputs: readonly BundleBuildTraceInput[];
  readonly buildTarget: string;
  readonly kind: 'linnya-bundle-build-trace';
  readonly outputs: readonly BundleBuildTraceOutput[];
  readonly schemaVersion: 1;
  readonly tool: Readonly<{
    readonly engine?: Readonly<{ readonly name: 'esbuild'; readonly version: string }>;
    name: BundleBuildTraceTool;
    version: string;
  }>;
  readonly workingDirectory: string;
}

export interface EsbuildMetafile {
  readonly inputs: Readonly<Record<string, {
    readonly bytes: number;
    readonly imports: readonly {
      readonly external?: boolean;
      readonly kind: string;
      readonly path: string;
    }[];
  }>>;
  readonly outputs: Readonly<Record<string, {
    readonly bytes: number;
    readonly entryPoint?: string;
    readonly imports: readonly {
      readonly external?: boolean;
      readonly kind: string;
      readonly path: string;
    }[];
    readonly inputs: Readonly<Record<string, { readonly bytesInOutput: number }>>;
  }>>;
}

export function isBundleTraceEnabled(environment?: NodeJS.ProcessEnv): boolean;

export function writeEsbuildBundleTrace(input: {
  readonly buildTarget: string;
  readonly engineVersion?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly metafile: EsbuildMetafile;
  readonly inputAttribution?: 'build-graph' | 'module-contribution';
  readonly repositoryRoot: string;
  readonly toolName?: 'esbuild' | 'tsup';
  readonly toolVersion: string;
  readonly workingDirectory: string;
}): string | undefined;

export function writeViteBundleTrace(input: {
  readonly buildInputs: readonly string[];
  readonly buildTarget: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly outputDirectory: string;
  readonly outputs: Readonly<Record<string, {
    readonly code?: string;
    readonly dynamicImports?: readonly string[];
    readonly facadeModuleId?: string | null;
    readonly fileName: string;
    readonly imports?: readonly string[];
    readonly modules?: Readonly<Record<string, { readonly renderedLength: number }>>;
    readonly source?: string | Uint8Array;
    readonly type: 'asset' | 'chunk';
  }>>;
  readonly repositoryRoot: string;
  readonly toolVersion: string;
  readonly workingDirectory: string;
}): string | undefined;

export function writeDerivedBundleTrace(input: {
  readonly buildTarget: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly repositoryRoot: string;
  readonly toolName: 'bytenode';
  readonly toolVersion: string;
}): string | undefined;
