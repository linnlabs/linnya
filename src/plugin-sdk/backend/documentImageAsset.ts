import type Database from 'better-sqlite3';
import {
  PluginDocumentImageAssetError,
  type PluginDocumentImageAssetRuntimePort,
} from '@linnya/plugin-host-contract/backend/documentImageAsset';
import { LINNYA_FLOW_IMAGE_INGRESS_POLICY } from 'src/app-hosts/linnya/adapters/flow/incoming-events/definitions/flowImageIngressPolicy';
import {
  createDocumentImageAssetRuntime as createHostDocumentImageAssetRuntime,
  createSqliteDocumentAssetOwnership,
  DocumentImageAssetRuntimeError,
} from 'src/app-hosts/linnya/application/document-image-assets';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import { readManagedImageStoreBinding } from 'src/domains/assets/features/managed-image-store-binding';
import {
  createLegacyAppManagedImageStoragePaths,
  createLegacyWorkspaceManagedImageStoragePaths,
  createManagedImageStoragePaths,
} from 'src/domains/assets/shared/managed-image-storage';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { getAppDataPath, getWorkspaceRoot } from 'src/shared/utils/pathManager';
import { requireDocumentAssetDatabase } from './documentAssetRuntimeDatabase';

let runtimeByDatabase = new WeakMap<Database.Database, PluginDocumentImageAssetRuntimePort>();

export function createDocumentImageAssetRuntime(
  databaseValue: unknown
): PluginDocumentImageAssetRuntimePort {
  const database = requireDocumentAssetDatabase(databaseValue);
  const cached = runtimeByDatabase.get(database);
  if (cached) return cached;

  let concreteRuntime: PluginDocumentImageAssetRuntimePort | null = null;
  const readConcreteRuntime = (): PluginDocumentImageAssetRuntimePort => {
    if (concreteRuntime) return concreteRuntime;
    const appDataRoot = getAppDataPath();
    const workspaceRoot = getWorkspaceRoot();
    const { storeId } = readManagedImageStoreBinding(database);
    const managedPaths = createManagedImageStoragePaths(appDataRoot, storeId);
    const legacyAppPaths = createLegacyAppManagedImageStoragePaths(appDataRoot);
    const legacyWorkspacePaths = createLegacyWorkspaceManagedImageStoragePaths(workspaceRoot);
    concreteRuntime = createHostDocumentImageAssetRuntime({
      imageIngress: createManagedImageIngress({
        appDataRoot,
        storeId,
        maxImageBytes: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImageBytes,
        maxImagePixels: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImagePixels,
        ledger: createSqliteLocalImageAssetLedger({ db: database }),
      }),
      imageLoader: createWorkspaceVerifiedImageLoader({
        db: database,
        storageBoundaries: [
          { boundaryRoot: appDataRoot, contentRoot: managedPaths.contentRoot },
          { boundaryRoot: appDataRoot, contentRoot: legacyAppPaths.contentRoot },
          { boundaryRoot: workspaceRoot, contentRoot: legacyWorkspacePaths.contentRoot },
        ],
        maxImagePixels: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImagePixels,
      }),
      ownership: createSqliteDocumentAssetOwnership(database),
    });
    return concreteRuntime;
  };
  async function runWithSafeFailure<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DocumentImageAssetRuntimeError) {
        throw new PluginDocumentImageAssetError(error.failure);
      }
      throw new PluginDocumentImageAssetError('store_unavailable');
    }
  }

  const runtime: PluginDocumentImageAssetRuntimePort = {
    adoptLocalImage: input =>
      runWithSafeFailure(() => readConcreteRuntime().adoptLocalImage(input)),
    adoptImageBytes: input =>
      runWithSafeFailure(() => readConcreteRuntime().adoptImageBytes(input)),
    readOwnedImage: input => runWithSafeFailure(() => readConcreteRuntime().readOwnedImage(input)),
  };
  runtimeByDatabase.set(database, runtime);
  return runtime;
}

export function resetDocumentImageAssetRuntimeCacheForTest(): void {
  runtimeByDatabase = new WeakMap<Database.Database, PluginDocumentImageAssetRuntimePort>();
}

export type {
  PluginDocumentImageAsset,
  PluginDocumentImageAssetFailure,
  PluginDocumentImageAssetRuntimePort,
  PluginDocumentImageMediaType,
} from '@linnya/plugin-host-contract/backend/documentImageAsset';
export { PluginDocumentImageAssetError } from '@linnya/plugin-host-contract/backend/documentImageAsset';
