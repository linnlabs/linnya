/**
 * @file readWorkspaceVfsNode.ts
 * @description 按 VFS path / inode 读取节点内容。
 */

import { promises as fsp } from 'fs';
import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import type { WorkspaceVfsError, WorkspaceVfsReadResult, WorkspaceVfsReadSuccess } from '../definitions/workspaceVfsRead';
import {
  createMarkdownReadDatabase,
  readMarkdownVfsContent,
} from 'src/domains/markdown';
import type { DocumentCitationProjection } from '../../../../domains/citation';
import { readPositiveInteger } from '../functions/readPositiveInteger';
import { listWorkspaceVfsNodes, type ListWorkspaceVfsNodesParams, type WorkspaceVfsDatabase } from './listWorkspaceVfsNodes';
import { resolveWorkspaceVfsNode } from './resolveWorkspaceVfsNode';
import {
  getDocumentTypeBackendHook,
  listDocumentTypeBackendSystemViewSpecs,
} from '@plugin/backend/documentTypeBackendHook';
import { readWorkspaceNodeTextSnapshot } from '../../infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';

interface ReadWorkspaceVfsNodeParams extends ListWorkspaceVfsNodesParams {
  readonly path?: string;
  readonly inode?: string;
  readonly maxChars?: number;
}

interface WorkspaceNodeRowForRead {
  readonly id: string;
  readonly type: string;
  readonly name: string;
}

function error(error_code: WorkspaceVfsError['error_code'], message: string, hint?: string): WorkspaceVfsError {
  return {
    ok: false,
    error_code,
    message,
    ...(hint ? { hint } : {}),
  };
}

function truncateText(text: string, maxChars: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxChars),
    truncated: true,
  };
}

function success(params: {
  readonly node: WorkspaceVfsNode;
  readonly contentType: WorkspaceVfsReadSuccess['contentType'];
  readonly text: string;
  readonly maxChars: number;
  readonly metadata?: Record<string, unknown>;
  readonly citationProjection?: DocumentCitationProjection;
}): WorkspaceVfsReadSuccess {
  const truncated = truncateText(params.text, params.maxChars);
  return {
    ok: true,
    node: params.node,
    contentType: params.contentType,
    text: truncated.text,
    truncated: truncated.truncated,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.citationProjection ? { citationProjection: params.citationProjection } : {}),
  };
}

function normalizeSnapshotContentType(contentType: string): WorkspaceVfsReadSuccess['contentType'] {
  if (
    contentType === 'text/markdown' ||
    contentType === 'text/plain' ||
    contentType === 'application/json'
  ) {
    return contentType;
  }
  return 'text/plain';
}

function readSnapshotContent(
  db: WorkspaceVfsDatabase,
  node: WorkspaceVfsNode,
  maxChars: number,
  snapshotNodeId: string = node.id
): WorkspaceVfsReadSuccess | null {
  const snapshot = readWorkspaceNodeTextSnapshot(db, snapshotNodeId);
  if (!snapshot) return null;
  return success({
    node,
    contentType: normalizeSnapshotContentType(snapshot.contentType),
    text: snapshot.text,
    maxChars,
    metadata: {
      view: 'workspace_node_text_snapshot',
      workspaceNodeId: snapshotNodeId,
      snapshotUpdatedAt: snapshot.updatedAt,
      sourcePluginId: snapshot.sourcePluginId,
      sourceNodeType: snapshot.sourceNodeType,
    },
  });
}

function readWorkspaceNodeRow(db: WorkspaceVfsDatabase, nodeId: string): WorkspaceNodeRowForRead | null {
  const row = db.prepare(`
    SELECT id, type, name
    FROM workspace_nodes
    WHERE id = ? AND deleted_at IS NULL
  `).get(nodeId) as WorkspaceNodeRowForRead | undefined;
  return row ?? null;
}

async function readFolder(params: ReadWorkspaceVfsNodeParams, node: WorkspaceVfsNode, maxChars: number): Promise<WorkspaceVfsReadResult> {
  const children = await listWorkspaceVfsNodes({ ...params, parentId: node.id });
  const text = children
    .map((child) => `${child.type === 'folder' ? 'dir ' : 'file'}\t${child.path}\t${child.inode}`)
    .join('\n');
  return success({
    node,
    contentType: 'inode/directory',
    text,
    maxChars,
    metadata: { childCount: children.length },
  });
}

function readWorkspaceDocument(params: ReadWorkspaceVfsNodeParams, node: WorkspaceVfsNode, maxChars: number): WorkspaceVfsReadResult {
  if (node.type === 'document') {
    const current = readMarkdownVfsContent({
      db: createMarkdownReadDatabase(params.db),
      documentId: node.id,
    });
    if (!current) return error('ENOENT', `Markdown document content not found: ${node.path}`);
    return success({
      node,
      contentType: current.contentType,
      text: current.text,
      maxChars,
      metadata: current.metadata,
      citationProjection: current.citationProjection,
    });
  }

  const hook = getDocumentTypeBackendHook(node.type, { includeDisabled: true });
  if (hook?.readVfsContent) {
    const nodeTypeAccessPolicy = params.nodeTypeAccessPolicy;
    if (nodeTypeAccessPolicy && !nodeTypeAccessPolicy.canReadContent(node.type)) {
      const snapshot = readSnapshotContent(params.db, node, maxChars);
      if (snapshot) return snapshot;
      return error('EINVAL', nodeTypeAccessPolicy.buildDisabledMessage(node.type, `读取 ${hook.displayName} 内容`));
    }
    const enabledHook = getDocumentTypeBackendHook(node.type);
    if (!enabledHook?.readVfsContent) {
      const snapshot = readSnapshotContent(params.db, node, maxChars);
      if (snapshot) return snapshot;
      return error('EINVAL', `${hook.displayName} 文档类型后端 hook 未启用，无法读取内容。`);
    }
    const result = enabledHook.readVfsContent({
      db: params.db,
      nodeId: node.id,
      nodeName: node.name,
      nodePath: node.path,
    });
    if (!result) return error('ENOENT', `${hook.displayName} content not found: ${node.path}`);
    return success({
      node,
      contentType: result.contentType,
      text: result.text,
      maxChars,
      ...(result.metadata ? { metadata: result.metadata } : {}),
    });
  }

  const snapshot = readSnapshotContent(params.db, node, maxChars);
  if (snapshot) return snapshot;

  return error('ENOTFILE', `Unsupported workspace file type: ${node.type}`);
}

function readSystemFile(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly node: WorkspaceVfsNode;
  readonly maxChars: number;
  readonly nodeTypeAccessPolicy?: ReadWorkspaceVfsNodeParams['nodeTypeAccessPolicy'];
}): WorkspaceVfsReadResult {
  const viewKind = params.node.payload?.viewKind;
  if (viewKind === 'protocol') {
    return success({
      node: params.node,
      contentType: 'text/markdown',
      text: [
        '# Linnya Workspace Path Layer v1',
        '',
        '- 主路径完全保留用户 workspace 树。',
        '- `.linnya` 是只读系统视图，不是用户目录。',
        '- `path` 适合人类阅读，`inode` 适合长任务稳定寻址。',
        '- KnowledgeBase 不进入项目 VFS；它保持项目外部的可绑定信息源语义。',
      ].join('\n'),
      maxChars: params.maxChars,
      metadata: { protocolVersion: 'v1' },
    });
  }

  const workspaceNodeId = params.node.payload?.workspaceNodeId;
  if (!workspaceNodeId) {
    return error('ENOENT', `System view is missing workspaceNodeId: ${params.node.path}`);
  }
  const workspaceRow = readWorkspaceNodeRow(params.db, workspaceNodeId);
  if (!workspaceRow) {
    return error('ENOENT', `Workspace node not found for system view: ${workspaceNodeId}`);
  }

  if (viewKind === 'document_content' && workspaceRow.type === 'document') {
    const current = readMarkdownVfsContent({
      db: createMarkdownReadDatabase(params.db),
      documentId: workspaceNodeId,
    });
    if (!current) return error('ENOENT', `Markdown document content not found: ${workspaceNodeId}`);
    return success({
      node: params.node,
      contentType: current.contentType,
      text: current.text,
      maxChars: params.maxChars,
      metadata: {
        workspaceNodeId,
        workspaceNodeName: workspaceRow.name,
        ...current.metadata,
      },
      citationProjection: current.citationProjection,
    });
  }

  const hook = getDocumentTypeBackendHook(workspaceRow.type, { includeDisabled: true });
  const hookSystemView = hook
    ? listDocumentTypeBackendSystemViewSpecs(hook).find((spec) => spec.viewKind === viewKind)
    : undefined;
  if (hook && hookSystemView) {
    const nodeTypeAccessPolicy = params.nodeTypeAccessPolicy;
    if (nodeTypeAccessPolicy && !nodeTypeAccessPolicy.canReadContent(workspaceRow.type)) {
      const snapshot = readSnapshotContent(params.db, params.node, params.maxChars, workspaceNodeId);
      if (snapshot) return snapshot;
      return error('EINVAL', nodeTypeAccessPolicy.buildDisabledMessage(workspaceRow.type, `读取 ${hook.displayName} 系统视图`));
    }
    const enabledHook = getDocumentTypeBackendHook(workspaceRow.type);
    if (!enabledHook?.readVfsContent) {
      const snapshot = readSnapshotContent(params.db, params.node, params.maxChars, workspaceNodeId);
      if (snapshot) return snapshot;
      return error('EINVAL', `${hook.displayName} 文档类型后端 hook 未启用，无法读取系统视图。`);
    }
    const result = enabledHook.readVfsContent({
      db: params.db,
      nodeId: workspaceNodeId,
      nodeName: workspaceRow.name,
      nodePath: params.node.path,
      viewKind,
    });
    if (!result) return error('ENOENT', `${hook.displayName} content not found: ${workspaceNodeId}`);
    return success({
      node: params.node,
      contentType: result.contentType,
      text: result.text,
      maxChars: params.maxChars,
      metadata: {
        workspaceNodeId,
        workspaceNodeName: workspaceRow.name,
        ...(result.metadata ?? {}),
      },
    });
  }

  return error('EINVAL', `System view ${viewKind ?? '(unknown)'} is not valid for workspace node type ${workspaceRow.type}.`);
}

export async function readWorkspaceVfsNode(params: ReadWorkspaceVfsNodeParams): Promise<WorkspaceVfsReadResult> {
  const maxChars = readPositiveInteger(params.maxChars) ?? 120000;
  const resolved = await resolveWorkspaceVfsNode({ ...params, includeSystemNodes: true });
  if (!resolved.ok) {
    return error('ENOENT', resolved.message, resolved.hint);
  }

  const node = resolved.node;
  if (node.type === 'folder') {
    return readFolder(params, node, maxChars);
  }

  if (node.type === 'system_file') {
    return readSystemFile({
      db: params.db,
      node,
      maxChars,
      nodeTypeAccessPolicy: params.nodeTypeAccessPolicy,
    });
  }

  return readWorkspaceDocument(params, node, maxChars);
}
