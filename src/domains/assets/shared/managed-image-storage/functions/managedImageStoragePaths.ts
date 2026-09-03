import path from 'node:path';
import {
  imageFileExtensionForMediaType,
  type SupportedImageMediaType,
} from 'src/shared/media/image-inspection';
import type {
  ManagedImageStoragePaths,
  ManagedImageWritableStoragePaths,
} from '../definitions/managedImageStorage';

const MANAGED_IMAGES_DIRECTORY = 'ConversationAttachments';
const MANAGED_IMAGES_VERSION = 'v2';
const LEGACY_MANAGED_IMAGES_VERSION = 'v1';
const MANAGED_IMAGE_RESOURCE_URI_PREFIX = '/Resources/Attachments';
const MANAGED_IMAGE_STORE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isManagedImageStoreId(value: string): boolean {
  return MANAGED_IMAGE_STORE_ID_PATTERN.test(value);
}

export function isManagedImageResourceUri(uri: string): boolean {
  return uri.startsWith(`${MANAGED_IMAGE_RESOURCE_URI_PREFIX}/`);
}

export function createManagedImageStoragePaths(
  appDataRoot: string,
  storeId: string,
): ManagedImageWritableStoragePaths {
  if (!isManagedImageStoreId(storeId)) {
    throw new Error('Managed image storage requires a valid store identity');
  }
  const managedRoot = path.join(
    appDataRoot,
    MANAGED_IMAGES_DIRECTORY,
    MANAGED_IMAGES_VERSION,
    'stores',
    storeId,
  );
  return {
    managedRoot,
    stagingRoot: path.join(managedRoot, 'staging'),
    contentRoot: path.join(managedRoot, 'content'),
    pendingRoot: path.join(managedRoot, 'pending'),
    quarantineRoot: path.join(managedRoot, 'quarantine'),
  };
}

/** 旧 AppData v1 只允许按已有 asset.local_path 读取或显式回收，禁止目录反向认领。 */
export function createLegacyAppManagedImageStoragePaths(
  appDataRoot: string,
): ManagedImageStoragePaths {
  const managedRoot = path.join(
    appDataRoot,
    MANAGED_IMAGES_DIRECTORY,
    LEGACY_MANAGED_IMAGES_VERSION,
  );
  return {
    managedRoot,
    stagingRoot: path.join(managedRoot, 'staging'),
    contentRoot: path.join(managedRoot, 'content'),
  };
}

/** 只供旧数据迁移与迁移期读取使用；新图片禁止写入 Workspace Root。 */
export function createLegacyWorkspaceManagedImageStoragePaths(
  workspaceRoot: string,
): ManagedImageStoragePaths {
  const managedRoot = path.join(workspaceRoot, 'ManagedAssets', 'v1');
  return {
    managedRoot,
    stagingRoot: path.join(managedRoot, 'staging'),
    contentRoot: path.join(managedRoot, 'content'),
  };
}

/** @deprecated 新代码直接使用共享的 imageFileExtensionForMediaType。 */
export const managedImageExtension = imageFileExtensionForMediaType;

export function createManagedImageContentIdentity(params: {
  readonly paths: ManagedImageStoragePaths;
  readonly sha256: string;
  readonly mediaType: SupportedImageMediaType;
}): { readonly uri: string; readonly localPath: string } {
  return createManagedContentIdentity({
    paths: params.paths,
    sha256: params.sha256,
    extension: imageFileExtensionForMediaType(params.mediaType),
  });
}

/**
 * 当前 v2 store 的物理内容寻址规则。
 * 这里只负责 hash → URI/path，不解释媒体；raster 与 admitted SVG 仍由各自 ingress 验证。
 */
export function createManagedContentIdentity(params: {
  readonly paths: ManagedImageStoragePaths;
  readonly sha256: string;
  readonly extension: 'jpg' | 'png' | 'webp' | 'svg';
}): { readonly uri: string; readonly localPath: string } {
  if (!/^[a-f0-9]{64}$/.test(params.sha256)) {
    throw new Error('Managed content identity requires a lowercase SHA-256.');
  }
  const prefix = params.sha256.slice(0, 2);
  const fileName = `${params.sha256}.${params.extension}`;
  return {
    uri: `${MANAGED_IMAGE_RESOURCE_URI_PREFIX}/${prefix}/${fileName}`,
    localPath: path.join(params.paths.contentRoot, prefix, fileName),
  };
}
