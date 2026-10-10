/**
 * @file searchWorkspaceVfsNodes.ts
 * @description 在 VFS 子树中按可见文本搜索。
 */

import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import type { WorkspaceVfsSearchMatch, WorkspaceVfsSearchResult } from '../definitions/workspaceVfsRead';
import { normalizeVfsPath } from '../functions/pathSegments';
import { compileWorkspaceSearchPattern, findLiteralMatchesInText } from '../functions/searchPattern';
import { listWorkspaceVfsNodes, type ListWorkspaceVfsNodesParams } from './listWorkspaceVfsNodes';
import { readWorkspaceVfsNode } from './readWorkspaceVfsNode';
import { resolveWorkspaceVfsNode } from './resolveWorkspaceVfsNode';
import { grepWorkspaceVfsSearchIndex, hasWorkspaceVfsSearchIndex } from './workspaceVfsSearchIndex';

interface SearchWorkspaceVfsNodesParams extends ListWorkspaceVfsNodesParams {
  readonly path?: string;
  readonly inode?: string;
  readonly pattern: string;
  readonly caseSensitive?: boolean;
  readonly maxResults?: number;
  readonly maxVisitedNodes?: number;
  readonly maxFileChars?: number;
}

async function collectFiles(params: ListWorkspaceVfsNodesParams, startNode: WorkspaceVfsNode | null, maxVisitedNodes: number): Promise<WorkspaceVfsNode[]> {
  const files: WorkspaceVfsNode[] = [];
  const queue: Array<string | null> = [startNode ? startNode.id : null];
  let visited = 0;

  while (queue.length > 0) {
    const parentId = queue.shift() ?? null;
    const children = await listWorkspaceVfsNodes({ ...params, parentId });
    for (const child of children) {
      visited += 1;
      if (visited > maxVisitedNodes) {
        return files;
      }
      if (child.type === 'folder') {
        queue.push(child.id);
      } else {
        files.push(child);
      }
    }
  }

  return files;
}

export async function searchWorkspaceVfsNodes(params: SearchWorkspaceVfsNodesParams): Promise<WorkspaceVfsSearchResult> {
  const pattern = params.pattern.trim();
  if (!pattern) {
    return {
      ok: false,
      error_code: 'EINVAL',
      message: 'search pattern is required.',
    };
  }

  const maxResults = params.maxResults && params.maxResults > 0 ? Math.floor(params.maxResults) : 50;
  const maxVisitedNodes = params.maxVisitedNodes && params.maxVisitedNodes > 0 ? Math.floor(params.maxVisitedNodes) : 10000;
  let isRootPath = false;
  if (params.path) {
    try {
      isRootPath = normalizeVfsPath(params.path) === '/';
    } catch (error) {
      return {
        ok: false,
        error_code: 'EINVAL',
        message: error instanceof Error ? error.message : 'Invalid VFS path.',
      };
    }
  }
  if (hasWorkspaceVfsSearchIndex(params.db)) {
    try {
      return await grepWorkspaceVfsSearchIndex({
        ...params,
        maxResults,
        maxIndexedNodes: maxVisitedNodes,
        maxFileChars: params.maxFileChars,
      });
    } catch (searchError) {
      return {
        ok: false,
        error_code: 'ENOENT',
        message: searchError instanceof Error ? searchError.message : String(searchError),
      };
    }
  }

  let startNode: WorkspaceVfsNode | null = null;

  if (params.inode || (params.path && !isRootPath)) {
    const resolved = await resolveWorkspaceVfsNode({ ...params, includeSystemNodes: true });
    if (!resolved.ok) {
      return {
        ok: false,
        error_code: 'ENOENT',
        message: resolved.message,
        ...(resolved.hint ? { hint: resolved.hint } : {}),
      };
    }
    startNode = resolved.node;
  }

  const files =
    startNode && startNode.type !== 'folder'
      ? [startNode]
      : await collectFiles(params, startNode, maxVisitedNodes);

  const matches: WorkspaceVfsSearchMatch[] = [];
  const compiled = compileWorkspaceSearchPattern({
    pattern,
    caseSensitive: params.caseSensitive,
  });
  for (const file of files) {
    if (matches.length >= maxResults) break;
    const read = await readWorkspaceVfsNode({
      ...params,
      inode: file.inode,
      path: undefined,
      maxChars: params.maxFileChars ?? 300000,
    });
    if (!read.ok) continue;
    const lineMatches = findLiteralMatchesInText({
      text: read.text,
      compiled,
      maxMatches: maxResults - matches.length,
    });
    matches.push(...lineMatches.map((match): WorkspaceVfsSearchMatch => ({
      node: file,
      line: match.line,
      column: match.column,
      preview: match.preview,
    })));
  }

  return {
    ok: true,
    matches,
    truncated: matches.length >= maxResults,
  };
}
