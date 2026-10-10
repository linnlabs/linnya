/**
 * @file searchWorkspaceVfsNodes.ts
 * @description 在 VFS 子树中按可见文本搜索。
 */

import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import {
  WORKSPACE_VFS_DIRECTORY_SEARCH_MAX_FILE_CHARS,
  type WorkspaceVfsSearchMatch,
  type WorkspaceVfsSearchResult,
} from '../definitions/workspaceVfsRead';
import { normalizeVfsPath } from '../functions/pathSegments';
import { compileWorkspaceSearchPattern, findLiteralMatchesInText } from '../functions/searchPattern';
import type { ListWorkspaceVfsNodesParams } from './listWorkspaceVfsNodes';
import { collectWorkspaceVfsSearchFiles } from './collectWorkspaceVfsSearchFiles';
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

  const isSingleFile = startNode !== null && startNode.type !== 'folder';
  // 指定单文件是在已定位的材料中查找。目录的有界前缀索引不能决定该文件没有匹配。
  if (!isSingleFile && hasWorkspaceVfsSearchIndex(params.db)) {
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

  const collected = await collectWorkspaceVfsSearchFiles(params, startNode, maxVisitedNodes);
  let incomplete = collected.truncated;
  const matches: WorkspaceVfsSearchMatch[] = [];
  const compiled = compileWorkspaceSearchPattern({
    pattern,
    caseSensitive: params.caseSensitive,
  });
  for (const file of collected.files) {
    if (matches.length > maxResults) break;
    const read = await readWorkspaceVfsNode({
      ...params,
      inode: file.inode,
      path: undefined,
      // VFS provider 本就产生完整投影；这里只避免目录索引截断，不增加读取工具参数。
      maxChars: isSingleFile ? Number.MAX_SAFE_INTEGER :
        params.maxFileChars ?? WORKSPACE_VFS_DIRECTORY_SEARCH_MAX_FILE_CHARS,
    });
    if (!read.ok) {
      if (isSingleFile) return read;
      incomplete = true;
      continue;
    }
    incomplete ||= read.truncated;
    const lineMatches = findLiteralMatchesInText({
      text: read.text,
      compiled,
      maxMatches: maxResults + 1 - matches.length,
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
    matches: matches.slice(0, maxResults),
    truncated: incomplete || matches.length > maxResults,
  };
}
