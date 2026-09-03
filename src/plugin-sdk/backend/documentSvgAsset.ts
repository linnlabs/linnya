import type Database from 'better-sqlite3';
import {
  PluginDocumentSvgAssetError,
  type PluginDocumentSvgAssetRuntimePort,
} from '@linnya/plugin-host-contract/backend/documentSvgAsset';
import {
  createDocumentSvgAssetRuntime as createHostDocumentSvgAssetRuntime,
  DocumentSvgAssetRuntimeError,
} from 'src/app-hosts/linnya/application/document-svg-assets';
import { createSqliteDocumentAssetOwnership } from 'src/app-hosts/linnya/application/document-assets';
import {
  createManagedSvgAssetRuntime,
  createSqliteManagedSvgAssetLedger,
} from 'src/domains/assets/features/managed-svg-asset';
import { readManagedImageStoreBinding } from 'src/domains/assets/features/managed-image-store-binding';
import { getAppDataPath } from 'src/shared/utils/pathManager';
import { requireDocumentAssetDatabase } from './documentAssetRuntimeDatabase';

const DOCUMENT_SVG_MAX_BYTES = 64 * 1024;

let runtimeByDatabase = new WeakMap<Database.Database, PluginDocumentSvgAssetRuntimePort>();

export function createDocumentSvgAssetRuntime(
  databaseValue: unknown
): PluginDocumentSvgAssetRuntimePort {
  const database = requireDocumentAssetDatabase(databaseValue);
  const cached = runtimeByDatabase.get(database);
  if (cached) return cached;

  let concreteRuntime: PluginDocumentSvgAssetRuntimePort | null = null;
  const readConcreteRuntime = (): PluginDocumentSvgAssetRuntimePort => {
    if (concreteRuntime) return concreteRuntime;
    const { storeId } = readManagedImageStoreBinding(database);
    concreteRuntime = createHostDocumentSvgAssetRuntime({
      svgAssets: createManagedSvgAssetRuntime({
        appDataRoot: getAppDataPath(),
        storeId,
        maxSvgBytes: DOCUMENT_SVG_MAX_BYTES,
        ledger: createSqliteManagedSvgAssetLedger({ db: database }),
      }),
      ownership: createSqliteDocumentAssetOwnership(database),
    });
    return concreteRuntime;
  };

  async function runWithSafeFailure<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DocumentSvgAssetRuntimeError) {
        throw new PluginDocumentSvgAssetError(error.failure);
      }
      throw new PluginDocumentSvgAssetError('store_unavailable');
    }
  }

  const runtime: PluginDocumentSvgAssetRuntimePort = {
    adoptCanonicalSvg: input =>
      runWithSafeFailure(() => readConcreteRuntime().adoptCanonicalSvg(input)),
    readOwnedSvg: input => runWithSafeFailure(() => readConcreteRuntime().readOwnedSvg(input)),
  };
  runtimeByDatabase.set(database, runtime);
  return runtime;
}

export function resetDocumentSvgAssetRuntimeCacheForTest(): void {
  runtimeByDatabase = new WeakMap<Database.Database, PluginDocumentSvgAssetRuntimePort>();
}

export type {
  PluginDocumentSvgAsset,
  PluginDocumentSvgAssetFailure,
  PluginDocumentSvgAssetRuntimePort,
} from '@linnya/plugin-host-contract/backend/documentSvgAsset';
export { PluginDocumentSvgAssetError } from '@linnya/plugin-host-contract/backend/documentSvgAsset';
