import type { DocumentPreviewType } from '@app/schemas';
import { listFormatOwnershipRecords } from '../../plugin-registry/formatOwnershipCatalog';
import { getDocumentTypeBackendHook } from 'src/plugin-sdk/backend/documentTypeBackendHook';

export function listDocumentPreviewTypes(): readonly DocumentPreviewType[] {
  const result: DocumentPreviewType[] = [{ nodeType: 'document', label: 'Markdown', pluginId: null, enabled: true, hasPreview: true }];
  const seen = new Set(['document']);
  for (const format of listFormatOwnershipRecords()) {
    if (seen.has(format.nodeType)) continue;
    seen.add(format.nodeType);
    const hook = getDocumentTypeBackendHook(format.nodeType);
    result.push({ nodeType: format.nodeType, label: format.label, pluginId: format.pluginId, enabled: hook !== undefined, hasPreview: hook?.preview !== undefined });
  }
  return result;
}
