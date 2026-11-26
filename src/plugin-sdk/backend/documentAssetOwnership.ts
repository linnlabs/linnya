import { listDocumentAssetByteFacts as listByteFacts } from 'src/domains/assets/features/document-asset-facts';
import { reconcileDocumentAssetOwnership as reconcile } from 'src/app-hosts/linnya/application/document-assets';
import { releaseDocumentAssetOwnership as release } from 'src/app-hosts/linnya/application/document-assets';
import { registerDocumentAssetOwnership as register } from 'src/app-hosts/linnya/application/document-assets';
import { requirePluginHostDatabase } from './pluginHostDatabase';

export function releaseDocumentAssetOwnership(input: { readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[] }): void {
  release(requirePluginHostDatabase(input.database, 'Document asset runtime'), input.documentId, input.assetIds);
}

export function registerDocumentAssetOwnership(input: {
  readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[]; readonly usageHint: string;
}): void {
  register({ ...input, database: requirePluginHostDatabase(input.database, 'Document asset runtime') });
}

export function listDocumentAssetByteFacts(input: { readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[] }) {
  return listByteFacts(requirePluginHostDatabase(input.database, 'Document asset runtime'), input.documentId, input.assetIds);
}

export function reconcileDocumentAssetOwnership(input: { readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[]; readonly usageHint: string }): void {
  reconcile({ ...input, database: requirePluginHostDatabase(input.database, 'Document asset runtime') });
}
