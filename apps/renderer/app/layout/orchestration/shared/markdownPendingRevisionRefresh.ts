import type { Editor as CoreEditor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useRevisionStore } from '@/domains/editor/features/Revision';
import { workspaceGateway, type PendingRevisionDTO } from '@/shared/ipc/workspaceGateway';
import { useFileStore } from '@/shared/stores/file';
import { useUIStore } from '@/shared/stores/ui';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasRootBlockId(editor: CoreEditor, blockId: string): boolean {
  if (!blockId) return false;
  const doc = editor.state.doc;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name === 'rootBlock' && node.attrs?.id === blockId) {
      return true;
    }
  }
  return false;
}

function getTopLevelRootBlockOrder(editor: CoreEditor): string[] {
  const order: string[] = [];
  const doc = editor.state.doc;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name !== 'rootBlock') continue;
    const id = node.attrs?.id;
    if (typeof id === 'string' && id.length > 0) {
      order.push(id);
    }
  }
  return order;
}

function getBackendRootBlocks(content: unknown): Array<{ id: string; json: Record<string, unknown> }> {
  if (!isRecord(content) || !Array.isArray(content.content)) return [];
  const roots: Array<{ id: string; json: Record<string, unknown> }> = [];
  for (const node of content.content) {
    if (!isRecord(node) || node.type !== 'rootBlock') continue;
    const attrs = node.attrs;
    if (!isRecord(attrs)) continue;
    const id = attrs?.id;
    if (typeof id === 'string' && id.length > 0) {
      roots.push({ id, json: node });
    }
  }
  return roots;
}

function syncRootBlockStructureFromBackend(editor: CoreEditor, backendContent: unknown): boolean {
  const backendRoots = getBackendRootBlocks(backendContent);
  if (backendRoots.length === 0) return false;

  const editorOrder = getTopLevelRootBlockOrder(editor);
  const editorNodes = new Map<string, ProseMirrorNode>();
  const doc = editor.state.doc;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name !== 'rootBlock') continue;
    const id = node.attrs?.id;
    if (typeof id === 'string' && id.length > 0) {
      editorNodes.set(id, node);
    }
  }

  const backendIdSet = new Set(backendRoots.map((root) => root.id));
  const isNonNullNode = (node: ProseMirrorNode | null): node is ProseMirrorNode => node !== null;

  const orderedNodes: ProseMirrorNode[] = backendRoots
    .map((root): ProseMirrorNode | null => {
      const existing = editorNodes.get(root.id);
      if (existing) return existing;
      try {
        return editor.state.schema.nodeFromJSON(root.json);
      } catch {
        return null;
      }
    })
    .filter(isNonNullNode);

  for (const id of editorOrder) {
    if (backendIdSet.has(id)) continue;
    const node = editorNodes.get(id);
    if (node) {
      orderedNodes.push(node);
    }
  }

  if (orderedNodes.length === 0) return false;
  const nextDoc = editor.state.schema.topNodeType.create(null, orderedNodes);
  editor.commands.setContent(nextDoc.toJSON(), false, { preserveWhitespace: 'full' });
  return true;
}

export async function applyPendingRevisionsToOpenMarkdownDocument(documentId: string): Promise<void> {
  if (!documentId.trim()) return;

  const fileStore = useFileStore();
  const currentDocumentId = fileStore.currentFilePath;
  if (!currentDocumentId || currentDocumentId !== documentId) return;

  const uiStore = useUIStore();
  const editor = uiStore.getEditor();
  if (!editor || editor.isDestroyed) {
    console.warn('[markdownPendingRevisionRefresh] 当前编辑器实例不可用，跳过 pending revisions 应用。');
    return;
  }

  const result = await workspaceGateway['read-document']({ documentId });
  if (!result.success || !result.data) {
    console.warn('[markdownPendingRevisionRefresh] read-document 失败，无法应用 pending revisions。', {
      documentId,
      error: 'error' in result ? result.error : undefined,
    });
    return;
  }

  const pendingFromGateway = result.data.pendingRevisions;
  const safePendingFromGateway: PendingRevisionDTO[] = Array.isArray(pendingFromGateway)
    ? pendingFromGateway
    : [];

  if (safePendingFromGateway.length > 0) {
    const missingBlockIds = safePendingFromGateway
      .map((revision) => revision.blockId)
      .filter((blockId) => !hasRootBlockId(editor, blockId));
    if (missingBlockIds.length > 0 && result.data.content) {
      if (fileStore.isDirty) {
        syncRootBlockStructureFromBackend(editor, result.data.content);
      } else {
        editor.commands.setContent(result.data.content, false, {
          preserveWhitespace: 'full',
        });
        fileStore.setDirty(false);
      }
    }
  }

  const revisionStore = useRevisionStore(editor);
  revisionStore.setWorkspacePendingRevisions(safePendingFromGateway.map((revision) => ({
    id: revision.id,
    blockId: revision.blockId,
    newMarkdown: revision.newMarkdown,
    source: revision.source,
    operation: revision.operation,
    metaJson: revision.metaJson,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
  })));
}
