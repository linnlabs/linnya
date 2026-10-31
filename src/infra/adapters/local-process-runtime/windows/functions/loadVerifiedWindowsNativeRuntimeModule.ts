import { createRequire } from 'node:module';
import {
  WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  WindowsNativeRuntimeLoadError,
  parseWindowsNativeRuntimeManifest,
} from '../definitions/windowsNativeRuntimeManifest';
import { verifyWindowsRuntimeArtifact } from './verifyWindowsRuntimeArtifact';

export interface WindowsNativeRuntimeFacts {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly nodeApiVersion: string | undefined;
}

export type WindowsNativeRuntimeTrust =
  | { readonly kind: 'development' }
  | { readonly kind: 'release_unsigned' }
  | {
    readonly kind: 'release';
    readonly expectedPublisherIdentity: string;
  };

export interface WindowsNativeRuntimeModuleLoaderOptions {
  readonly manifestPath: string;
  readonly expectedRuntimeVersion: string;
  readonly expectedApplicationVersion: string;
  readonly trust: WindowsNativeRuntimeTrust;
  readonly runtimeFacts?: WindowsNativeRuntimeFacts;
  readonly loadNativeModule?: (artifactPath: string) => unknown;
}

export interface WindowsNativeRuntimeModuleLoader {
  load(): Promise<unknown>;
}

function parseNodeApiVersion(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function defaultLoadNativeModule(artifactPath: string): unknown {
  const requireFromArtifact = createRequire(artifactPath);
  return requireFromArtifact(artifactPath) as unknown;
}

async function loadNativeModule(
  options: Readonly<WindowsNativeRuntimeModuleLoaderOptions>,
): Promise<unknown> {
  const { artifactPath, manifest } = await verifyWindowsRuntimeArtifact(options, {
    parseManifest: parseWindowsNativeRuntimeManifest,
    artifactFileName: WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  });
  const nodeApiVersion = parseNodeApiVersion(
    options.runtimeFacts ? options.runtimeFacts.nodeApiVersion : process.versions.napi,
  );
  if (nodeApiVersion === undefined || nodeApiVersion < manifest.minimum_node_api_version) {
    throw new WindowsNativeRuntimeLoadError(
      'runtime_mismatch',
      'Windows local process runtime does not match the active Node API',
    );
  }
  try {
    return (options.loadNativeModule ?? defaultLoadNativeModule)(artifactPath);
  } catch (error) {
    throw new WindowsNativeRuntimeLoadError(
      'binding_load_failed',
      'Windows local process runtime native module failed to load',
      { cause: error },
    );
  }
}

function freezeLoaderOptions(
  options: WindowsNativeRuntimeModuleLoaderOptions,
): Readonly<WindowsNativeRuntimeModuleLoaderOptions> {
  return Object.freeze({
    manifestPath: options.manifestPath,
    expectedRuntimeVersion: options.expectedRuntimeVersion,
    expectedApplicationVersion: options.expectedApplicationVersion,
    trust: Object.freeze({ ...options.trust }),
    runtimeFacts: options.runtimeFacts
      ? Object.freeze({ ...options.runtimeFacts })
      : undefined,
    loadNativeModule: options.loadNativeModule,
  });
}

/**
 * 同一 Utility generation 只验证并加载一次。失败也保持稳定，避免损坏安装在
 * 同一 owner 内反复读盘；下一次 Utility 必须创建新的 loader 并重新验证制品。
 */
export function createVerifiedWindowsNativeRuntimeModuleLoader(
  options: WindowsNativeRuntimeModuleLoaderOptions,
): WindowsNativeRuntimeModuleLoader {
  const frozenOptions = freezeLoaderOptions(options);
  let result: Promise<unknown> | undefined;
  return Object.freeze({
    load() {
      result ??= loadNativeModule(frozenOptions);
      return result;
    },
  });
}
