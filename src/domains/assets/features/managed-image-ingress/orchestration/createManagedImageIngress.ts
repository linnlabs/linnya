import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { inspectImageBytes } from 'src/shared/media/image-inspection';
import type {
  ManagedImageContentIngressPort,
  ManagedImageIngressDependencies,
} from '../definitions/managedImageIngress';
import { ManagedImageIngressError } from '../definitions/managedImageIngress';
import {
  createManagedImageContentIdentity,
  createManagedImageStoragePaths,
  completeManagedImagePublish,
  type ManagedImagePendingPublish,
  ManagedImagePublishError,
  publishStagedManagedImage,
} from '../../../shared/managed-image-storage';

async function readSource(params: {
  readonly sourcePath: string;
  readonly maxImageBytes: number;
}): Promise<Buffer> {
  let stat;
  try {
    stat = await fsp.lstat(params.sourcePath);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new ManagedImageIngressError('source_not_found');
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new ManagedImageIngressError('source_not_file');
  }
  if (stat.size > params.maxImageBytes) {
    throw new ManagedImageIngressError('source_too_large');
  }
  return fsp.readFile(params.sourcePath);
}

export function createManagedImageIngress(
  dependencies: ManagedImageIngressDependencies
): ManagedImageContentIngressPort {
  if (!Number.isSafeInteger(dependencies.maxImageBytes) || dependencies.maxImageBytes <= 0) {
    throw new ManagedImageIngressError('invalid_byte_limit');
  }
  if (!Number.isSafeInteger(dependencies.maxImagePixels) || dependencies.maxImagePixels <= 0) {
    throw new ManagedImageIngressError('invalid_pixel_limit');
  }
  const paths = createManagedImageStoragePaths(dependencies.appDataRoot, dependencies.storeId);
  const createStagingId = dependencies.createStagingId ?? randomUUID;

  async function ingestBytes(input: { readonly bytes: Uint8Array; readonly createdAt?: string }) {
    if (input.bytes.byteLength > dependencies.maxImageBytes) {
      throw new ManagedImageIngressError('source_too_large');
    }
    const bytes = Buffer.from(input.bytes);
    const inspected = await inspectImageBytes({
      bytes,
      maxImagePixels: dependencies.maxImagePixels,
    });
    const identity = createManagedImageContentIdentity({
      paths,
      sha256: inspected.sha256,
      mediaType: inspected.mediaType,
    });
    await fsp.mkdir(paths.stagingRoot, { recursive: true });
    const publishId = createStagingId();
    const stagingPath = path.join(paths.stagingRoot, `artifact-${publishId}.upload`);
    await fsp.writeFile(stagingPath, bytes, { flag: 'wx' });
    let pendingPublish: ManagedImagePendingPublish;
    try {
      pendingPublish = await publishStagedManagedImage({
        paths,
        publishId,
        stagingPath,
        finalPath: identity.localPath,
        expectedSha256: inspected.sha256,
      });
    } catch (error: unknown) {
      await fsp.rm(stagingPath, { force: true });
      if (error instanceof ManagedImagePublishError) {
        throw new ManagedImageIngressError('content_address_conflict');
      }
      throw error;
    }

    try {
      const parsedCreatedAt = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
      const registered = dependencies.ledger.registerLocalImage({
        uri: identity.uri,
        mediaType: inspected.mediaType,
        byteLength: inspected.byteLength,
        width: inspected.width,
        height: inspected.height,
        sha256: inspected.sha256,
        localPath: identity.localPath,
        createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
      });
      await completeManagedImagePublish(pendingPublish);
      return registered;
    } finally {
      // hard link 发布后 staging 已不再承载所有权；失败恢复只依赖 pending 凭证。
      await fsp.rm(stagingPath, { force: true });
    }
  }

  return {
    async ingestLocalImage(input) {
      const bytes = await readSource({
        sourcePath: input.sourcePath,
        maxImageBytes: dependencies.maxImageBytes,
      });
      return ingestBytes({
        bytes,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      });
    },
    async ingestImageBytes(input) {
      return ingestBytes(input);
    },
  };
}
