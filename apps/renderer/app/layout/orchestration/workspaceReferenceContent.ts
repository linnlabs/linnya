import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import type { WorkspaceReferenceContentPort } from '@/shared/ports/workspaceReferenceContentPort';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractRootBlockIdsFromProseMirrorDoc(content: unknown): string[] {
  if (!isRecord(content) || !Array.isArray(content.content)) return [];

  const blockIds: string[] = [];
  for (const node of content.content) {
    if (!isRecord(node) || node.type !== 'rootBlock') continue;
    const attrs = isRecord(node.attrs) ? node.attrs : null;
    const id = typeof attrs?.id === 'string' ? attrs.id : '';
    if (id) blockIds.push(id);
  }
  return blockIds;
}

export function createWorkspaceReferenceContent(): WorkspaceReferenceContentPort {
  return {
    async getMarkdownRootBlockIds(documentId) {
      if (!documentId.trim()) return [];

      const result = await workspaceGateway['read-document']({ documentId });
      if (!result.success) return [];

      return extractRootBlockIdsFromProseMirrorDoc(result.data?.content);
    },
  };
}
