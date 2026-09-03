import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isPathInsideRoot } from 'src/shared/filesystem/managedPath';
import {
  completeManagedContentPublish,
  createManagedContentIdentity,
  createManagedImageStoragePaths,
  ManagedContentPublishError,
  publishStagedManagedContent,
  type ManagedContentPendingPublish,
} from '../../../shared/managed-image-storage';
import {
  MANAGED_SVG_MEDIA_TYPE,
  ManagedSvgAssetError,
  type ManagedSvgAssetRuntimeDependencies,
  type ManagedSvgAssetRuntimePort,
  type MaterializedManagedSvgAsset,
  type RegisteredManagedSvgAsset,
} from '../definitions/managedSvgAsset';

export function createManagedSvgAssetRuntime(
  dependencies: ManagedSvgAssetRuntimeDependencies
): ManagedSvgAssetRuntimePort {
  if (!Number.isSafeInteger(dependencies.maxSvgBytes) || dependencies.maxSvgBytes <= 0) {
    throw new ManagedSvgAssetError('content_limit_exceeded');
  }
  const paths = createManagedImageStoragePaths(dependencies.appDataRoot, dependencies.storeId);
  const createStagingId = dependencies.createStagingId ?? randomUUID;

  async function materialize(
    registered: RegisteredManagedSvgAsset
  ): Promise<MaterializedManagedSvgAsset> {
    const stat = await fsp.lstat(registered.localPath).catch(() => null);
    if (!stat?.isFile()) throw new ManagedSvgAssetError('asset_unavailable');
    const [contentRoot, filePath] = await Promise.all([
      fsp.realpath(paths.contentRoot).catch(() => null),
      fsp.realpath(registered.localPath).catch(() => null),
    ]);
    if (!contentRoot || !filePath || !isPathInsideRoot(contentRoot, filePath)) {
      throw new ManagedSvgAssetError('asset_unavailable');
    }
    const bytes = await fsp.readFile(filePath).catch(() => null);
    if (!bytes) throw new ManagedSvgAssetError('asset_unavailable');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const canonicalSvg = bytes.toString('utf8');
    if (
      bytes.byteLength !== registered.byteLength ||
      sha256 !== registered.sha256 ||
      Buffer.from(canonicalSvg, 'utf8').compare(bytes) !== 0
    ) {
      throw new ManagedSvgAssetError('integrity_failed');
    }
    return {
      assetId: registered.assetId,
      mediaType: MANAGED_SVG_MEDIA_TYPE,
      byteLength: registered.byteLength,
      sha256: registered.sha256,
      canonicalSvg,
    };
  }

  return {
    async adoptCanonicalSvg(input): Promise<MaterializedManagedSvgAsset> {
      const bytes = Buffer.from(input.canonicalSvg, 'utf8');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > dependencies.maxSvgBytes ||
        Buffer.from(bytes.toString('utf8'), 'utf8').compare(bytes) !== 0
      ) {
        throw new ManagedSvgAssetError(
          bytes.byteLength > dependencies.maxSvgBytes
            ? 'content_limit_exceeded'
            : 'invalid_canonical_content'
        );
      }
      if (sha256 !== input.contentHash) {
        throw new ManagedSvgAssetError('invalid_canonical_content');
      }

      const identity = createManagedContentIdentity({
        paths,
        sha256,
        extension: 'svg',
      });
      await fsp.mkdir(paths.stagingRoot, { recursive: true });
      const publishId = createStagingId();
      const stagingPath = path.join(paths.stagingRoot, `svg-${publishId}.upload`);
      await fsp.writeFile(stagingPath, bytes, { flag: 'wx' });
      let pending: ManagedContentPendingPublish;
      try {
        pending = await publishStagedManagedContent({
          paths,
          publishId,
          stagingPath,
          finalPath: identity.localPath,
          expectedSha256: sha256,
        });
      } catch (error) {
        await fsp.rm(stagingPath, { force: true });
        if (error instanceof ManagedContentPublishError) {
          throw new ManagedSvgAssetError('storage_conflict');
        }
        throw error;
      }

      try {
        const registered = dependencies.ledger.register({
          uri: identity.uri,
          mediaType: MANAGED_SVG_MEDIA_TYPE,
          byteLength: bytes.byteLength,
          sha256,
          localPath: identity.localPath,
          createdAt: Date.now(),
        });
        await completeManagedContentPublish(pending);
        return materialize(registered);
      } finally {
        // 正式文件由 content hash 和 pending receipt 接管；staging 不再承担所有权。
        await fsp.rm(stagingPath, { force: true });
      }
    },
    async readManagedSvg(input): Promise<MaterializedManagedSvgAsset> {
      const registered = dependencies.ledger.findById(input.assetId);
      if (!registered) throw new ManagedSvgAssetError('asset_unavailable');
      return materialize(registered);
    },
  };
}
