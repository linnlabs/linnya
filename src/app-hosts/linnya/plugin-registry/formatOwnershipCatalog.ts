import type { PluginId, PluginMeta } from '@app/schemas';
import { backendPluginRegistry } from './registry';

export interface FormatOwnershipRecord {
  readonly pluginId: PluginId;
  readonly pluginName: string;
  readonly nodeType: string;
  readonly extension: string;
  readonly label: string;
}

function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase();
}

function normalizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase();
}

export function listFormatOwnershipRecords(
  metas: readonly PluginMeta[] = backendPluginRegistry.listMeta()
): FormatOwnershipRecord[] {
  const records: FormatOwnershipRecord[] = [];
  for (const meta of metas) {
    for (const ownedType of meta.ownedFileTypes ?? []) {
      records.push({
        pluginId: meta.id,
        pluginName: meta.name,
        nodeType: ownedType.nodeType,
        extension: normalizeExtension(ownedType.extension),
        label: ownedType.label,
      });
    }
  }
  return records;
}

export function findFormatOwnershipByNodeType(
  nodeType: string,
  metas?: readonly PluginMeta[]
): FormatOwnershipRecord | null {
  return listFormatOwnershipRecords(metas).find((record) => record.nodeType === nodeType) ?? null;
}

export function findFormatOwnershipByExtension(
  fileName: string,
  metas?: readonly PluginMeta[]
): FormatOwnershipRecord | null {
  const normalizedFileName = normalizeFileName(fileName);
  return listFormatOwnershipRecords(metas)
    .find((record) => normalizedFileName.endsWith(record.extension)) ?? null;
}
