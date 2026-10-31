import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WindowsNativeRuntimeLoadError } from '../definitions/windowsNativeRuntimeManifest';
import type { WindowsRuntimeArtifactManifest } from '../definitions/windowsRuntimeArtifactManifest';
import type { WindowsNativeRuntimeModuleLoaderOptions } from './loadVerifiedWindowsNativeRuntimeModule';

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

/** 验证固定制品；调用方的 schema 必须固定文件名，不能从 manifest 接受任意启动路径。 */
export async function verifyWindowsRuntimeArtifact<M extends WindowsRuntimeArtifactManifest>(
  options: WindowsNativeRuntimeModuleLoaderOptions,
  contract: {
    readonly parseManifest: (value: unknown) => M;
    readonly artifactFileName: string;
  },
): Promise<{ readonly artifactPath: string; readonly manifest: M }> {
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

  let manifest: M;
  try {
    manifest = contract.parseManifest(
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

  const facts = options.runtimeFacts ?? { platform: process.platform, architecture: process.arch };
  if (
    facts.platform !== manifest.platform
    || facts.architecture !== manifest.architecture
    || options.expectedRuntimeVersion !== manifest.runtime_version
    || options.expectedApplicationVersion !== manifest.application_version
  ) {
    throw new WindowsNativeRuntimeLoadError(
      'runtime_mismatch',
      'Windows local process runtime does not match the active application runtime',
    );
  }
  if (
    options.trust.kind === 'release_unsigned'
    && manifest.signature_evidence.kind !== 'release_unsigned'
  ) {
    throw new WindowsNativeRuntimeLoadError(
      'runtime_signature_unverified',
      'Windows local process runtime was not finalized for an unsigned release',
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
    contract.artifactFileName,
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

  return { artifactPath: artifactRealPath, manifest };
}
