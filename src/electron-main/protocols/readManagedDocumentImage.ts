import { getDatabaseService } from '../services/database';
import { getAppDataPath, getWorkspaceRoot } from '../../shared/utils/pathManager';
import { readManagedImageStoreBinding } from '../../domains/assets/features/managed-image-store-binding';
import {
  createManagedImageStoragePaths,
  createLegacyAppManagedImageStoragePaths,
  createLegacyWorkspaceManagedImageStoragePaths,
} from '../../domains/assets/shared/managed-image-storage';
import { createWorkspaceVerifiedImageLoader } from '../../features/workspace/assets/shared/verified-image';
import { readDocumentImageAsset } from '../../app-hosts/linnya/application/markdown-image-assets/readDocumentImageAsset';
import { ASSET_IMAGE_MAX_PIXELS } from '../../domains/assets/definitions/imageAssetPolicy';

/** 按资产身份读当前账本位置，工作目录搬迁后不依赖旧绝对路径。 */
export async function readManagedDocumentImage(assetId: string) {
  const db = getDatabaseService().getDb();
  const appDataRoot = getAppDataPath();
  const workspaceRoot = getWorkspaceRoot();
  const { storeId } = readManagedImageStoreBinding(db);
  const loader = createWorkspaceVerifiedImageLoader({
    db,
    storageBoundaries: [
      {
        boundaryRoot: appDataRoot,
        contentRoot: createManagedImageStoragePaths(appDataRoot, storeId).contentRoot,
      },
      {
        boundaryRoot: appDataRoot,
        contentRoot: createLegacyAppManagedImageStoragePaths(appDataRoot).contentRoot,
      },
      {
        boundaryRoot: workspaceRoot,
        contentRoot: createLegacyWorkspaceManagedImageStoragePaths(workspaceRoot).contentRoot,
      },
    ],
    maxImagePixels: ASSET_IMAGE_MAX_PIXELS,
  });
  return readDocumentImageAsset({ db, loader, assetId });
}
