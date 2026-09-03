import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  WindowsNativeRuntimeLoadError,
  parseWindowsNativeRuntimeManifest,
  type WindowsNativeRuntimeManifest,
} from '../definitions/windowsNativeRuntimeManifest';

export interface WindowsNativeRuntimeFacts {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly nodeApiVersion: string | undefined;
}

export type WindowsNativeRuntimeTrust =
  | { readonly kind: 'development' }
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

function currentRuntimeFacts(): WindowsNativeRuntimeFacts {
  return {
    platform: process.platform,
    architecture: process.arch,
    nodeApiVersion: process.versions.napi,
  };
}

function parseNodeApiVersion(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function includesAsarArchiveSegment(filePath: string): boolean {
  return filePath
    .split(/[\\/]+/u)
    .some(segment => segment.toLocaleLowerCase('en-US') === 'app.asar');
}

async function readManifest(manifestPath: string): Promise<unknown> {
  let bytes: Buffer;
  try {
    bytes = await readFile(manifestPath);
  } catch (error) {
    throw new WindowsNativeRuntimeLoadError(
      'manifest_unavailable',
      'Windows local process runtime manifest is unavailable',
      { cause: error },
    );
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new WindowsNativeRuntimeLoadError(
      'manifest_invalid',
      'Windows local process runtime manifest is not valid JSON',
      { cause: error },
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash('sha256');
  try {
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  } catch (error) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_unavailable',
      'Windows local process runtime artifact cannot be read',
      { cause: error },
    );
  }
  return digest.digest('hex');
}

function defaultLoadNativeModule(artifactPath: string): unknown {
  const requireFromArtifact = createRequire(artifactPath);
  return requireFromArtifact(artifactPath) as unknown;
}

async function loadNativeModule(
  options: Readonly<WindowsNativeRuntimeModuleLoaderOptions>,
): Promise<unknown> {
  if (!path.isAbsolute(options.manifestPath)) {
    throw new WindowsNativeRuntimeLoadError(
      'manifest_invalid',
      'Windows local process runtime manifest path must be absolute',
    );
  }
  if (includesAsarArchiveSegment(options.manifestPath)) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_not_unpacked',
      'Windows local process runtime must be loaded from a real unpacked directory',
    );
  }

  let manifest: WindowsNativeRuntimeManifest;
  try {
    manifest = parseWindowsNativeRuntimeManifest(
      await readManifest(options.manifestPath),
    );
  } catch (error) {
    if (error instanceof WindowsNativeRuntimeLoadError) throw error;
    throw new WindowsNativeRuntimeLoadError(
      'manifest_invalid',
      'Windows local process runtime manifest does not satisfy its schema',
      { cause: error },
    );
  }

  const facts = options.runtimeFacts ?? currentRuntimeFacts();
  const nodeApiVersion = parseNodeApiVersion(facts.nodeApiVersion);
  if (
    facts.platform !== manifest.platform
    || facts.architecture !== manifest.architecture
    || options.expectedRuntimeVersion !== manifest.runtime_version
    || options.expectedApplicationVersion !== manifest.application_version
    || nodeApiVersion === undefined
    || nodeApiVersion < manifest.minimum_node_api_version
  ) {
    throw new WindowsNativeRuntimeLoadError(
      'runtime_mismatch',
      'Windows local process runtime does not match the active application runtime',
    );
  }
  if (
    options.trust.kind === 'release'
    && (
      manifest.signature_evidence.kind !== 'authenticode_build_verified'
      || manifest.signature_evidence.publisher_identity
        !== options.trust.expectedPublisherIdentity
    )
  ) {
    throw new WindowsNativeRuntimeLoadError(
      'runtime_signature_unverified',
      'Windows local process runtime was not verified by the release signing pipeline',
    );
  }

  const artifactPath = path.join(
    path.dirname(options.manifestPath),
    WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  );
  if (includesAsarArchiveSegment(artifactPath)) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_not_unpacked',
      'Windows local process runtime artifact is inside app.asar',
    );
  }

  let manifestRealPath: string;
  let artifactRealPath: string;
  let artifactStat: Stats;
  try {
    [manifestRealPath, artifactRealPath, artifactStat] = await Promise.all([
      realpath(options.manifestPath),
      realpath(artifactPath),
      stat(artifactPath),
    ]);
  } catch (error) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_unavailable',
      'Windows local process runtime artifact is unavailable',
      { cause: error },
    );
  }
  if (!artifactStat.isFile()) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_unavailable',
      'Windows local process runtime artifact is not a regular file',
    );
  }
  // 允许整个安装根经 junction 解析，但 artifact 不能单独跳出 manifest 所在目录。
  if (path.dirname(manifestRealPath) !== path.dirname(artifactRealPath)) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_not_unpacked',
      'Windows local process runtime artifact resolves outside its manifest directory',
    );
  }
  if (artifactStat.size !== manifest.artifact.size_bytes) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_size_mismatch',
      'Windows local process runtime artifact size does not match its manifest',
    );
  }
  if (await sha256File(artifactRealPath) !== manifest.artifact.sha256) {
    throw new WindowsNativeRuntimeLoadError(
      'artifact_hash_mismatch',
      'Windows local process runtime artifact hash does not match its manifest',
    );
  }

  try {
    return (options.loadNativeModule ?? defaultLoadNativeModule)(artifactRealPath);
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
