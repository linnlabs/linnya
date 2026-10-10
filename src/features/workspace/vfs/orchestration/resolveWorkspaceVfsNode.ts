/**
 * @file resolveWorkspaceVfsNode.ts
 * @description 将 VFS path / inode 解析为统一节点。
 */

import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import { normalizeVfsPath, splitNormalizedVfsPath } from '../functions/pathSegments';
import { listWorkspaceVfsNodes, type ListWorkspaceVfsNodesParams } from './listWorkspaceVfsNodes';

export interface ResolveWorkspaceVfsNodeParams extends ListWorkspaceVfsNodesParams {
  readonly path?: string;
  readonly inode?: string;
  readonly maxVisitedNodes?: number;
}

export type ResolveWorkspaceVfsNodeResult =
  | { readonly ok: true; readonly node: WorkspaceVfsNode }
  | { readonly ok: false; readonly message: string; readonly hint?: string };

function matchesInode(node: WorkspaceVfsNode, inode: string): boolean {
  return node.inode === inode || node.id === inode;
}

async function resolveByPath(params: ResolveWorkspaceVfsNodeParams, pathValue: string): Promise<ResolveWorkspaceVfsNodeResult> {
  let segments: string[];
  try {
    segments = splitNormalizedVfsPath(pathValue);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid VFS path.',
    };
  }

  if (segments.length === 0) {
    return {
      ok: false,
      message: 'Root path is a directory.',
      hint: 'Use list_files("/") instead.',
    };
  }

  let parentId: string | null = null;
  let current: WorkspaceVfsNode | null = null;
  for (const segment of segments) {
    const children = await listWorkspaceVfsNodes({ ...params, parentId });
    const match = children.find((node) => node.name === segment);
    if (!match) {
      return {
        ok: false,
        message: `Path not found: ${normalizeVfsPath(pathValue)}`,
        hint: parentId ? `Missing segment: ${segment}` : `Missing root item: ${segment}`,
      };
    }
    current = match;
    parentId = match.id;
  }

  if (!current) {
    return {
      ok: false,
      message: `Path not found: ${normalizeVfsPath(pathValue)}`,
    };
  }

  return { ok: true, node: current };
}

async function resolveByInode(params: ResolveWorkspaceVfsNodeParams, inode: string): Promise<ResolveWorkspaceVfsNodeResult> {
  const normalizedInode = inode.trim();
  if (!normalizedInode) {
    return { ok: false, message: 'inode is required.' };
  }

  const maxVisitedNodes = params.maxVisitedNodes ?? 10000;
  const queue: Array<string | null> = [null];
  let visited = 0;

  while (queue.length > 0) {
    const parentId = queue.shift() ?? null;
    const children = await listWorkspaceVfsNodes({ ...params, parentId });
    for (const child of children) {
      visited += 1;
      if (visited > maxVisitedNodes) {
        return {
          ok: false,
          message: 'VFS inode resolution visited too many nodes.',
          hint: 'Use a direct path or narrow the folder.',
        };
      }
      if (matchesInode(child, normalizedInode)) {
        return { ok: true, node: child };
      }
      if (child.type === 'folder') {
        queue.push(child.id);
      }
    }
  }

  return {
    ok: false,
    message: `Inode not found: ${normalizedInode}`,
  };
}

export async function resolveWorkspaceVfsNode(params: ResolveWorkspaceVfsNodeParams): Promise<ResolveWorkspaceVfsNodeResult> {
  if (params.inode) {
    return resolveByInode(params, params.inode);
  }
  if (params.path) {
    return resolveByPath(params, params.path);
  }
  return {
    ok: false,
    message: 'path or inode is required.',
  };
}
