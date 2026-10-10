/**
 * @file workspaceVfsSearchIndex.ts
 * @description Workspace Path Layer 的行级 grep 搜索索引。
 */

import { createHash } from 'crypto';
import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import type { WorkspaceVfsSearchIndexMetadata, WorkspaceVfsSearchMatch } from '../definitions/workspaceVfsRead';
import {
  buildUniqueTrigrams,
  compileWorkspaceSearchPattern,
  findLiteralMatchInLine,
} from '../functions/searchPattern';
import { normalizeVfsPath } from '../functions/pathSegments';
import { listWorkspaceVfsNodes, type ListWorkspaceVfsNodesParams, type WorkspaceVfsDatabase } from './listWorkspaceVfsNodes';
import { readWorkspaceVfsNode } from './readWorkspaceVfsNode';
import { resolveWorkspaceVfsNode } from './resolveWorkspaceVfsNode';
import { hasWorkspaceNodeTextSnapshot } from '../../infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_INDEXED_NODES = 5000;
const DEFAULT_MAX_FILE_CHARS = 120000;
const MAX_QUERY_GRAMS = 16;
const MAX_CANDIDATE_ROWS = 5000;

interface SearchIndexLineRow {
  readonly id: string;
  readonly project_id: string;
  readonly inode: string;
  readonly path: string;
  readonly name: string;
  readonly node_type: WorkspaceVfsNode['type'];
  readonly source: WorkspaceVfsNode['source'];
  readonly content_kind: string;
  readonly line_no: number;
  readonly text: string;
  readonly text_lc: string;
  readonly content_hash: string;
  readonly node_updated_at: number;
  readonly indexed_at: number;
}

interface SearchIndexFreshnessRow {
  readonly content_hash: string;
  readonly node_updated_at: number;
  readonly path: string;
}

interface SearchIndexInodeRow {
  readonly inode: string;
}

export interface WorkspaceVfsIndexedGrepParams extends ListWorkspaceVfsNodesParams {
  readonly path?: string;
  readonly inode?: string;
  readonly pattern: string;
  readonly caseSensitive?: boolean;
  readonly maxResults?: number;
  readonly maxIndexedNodes?: number;
  readonly maxFileChars?: number;
}

export interface WorkspaceVfsIndexedGrepResult {
  readonly ok: true;
  readonly matches: WorkspaceVfsSearchMatch[];
  readonly truncated: boolean;
  readonly index: WorkspaceVfsSearchIndexMetadata;
}

export function hasWorkspaceVfsSearchIndex(db: WorkspaceVfsDatabase): boolean {
  try {
    const row = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'workspace_vfs_search_lines'
      LIMIT 1
    `).get() as { name?: string } | undefined;
    return row?.name === 'workspace_vfs_search_lines';
  } catch {
    return false;
  }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hashLineId(params: {
  readonly projectId: string;
  readonly inode: string;
  readonly contentKind: string;
  readonly lineNo: number;
}): string {
  return createHash('sha1')
    .update(params.projectId)
    .update('\0')
    .update(params.inode)
    .update('\0')
    .update(params.contentKind)
    .update('\0')
    .update(String(params.lineNo))
    .digest('hex');
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (matched) => `\\${matched}`);
}

function buildIndexedNode(row: SearchIndexLineRow): WorkspaceVfsNode {
  return {
    id: row.inode,
    inode: row.inode,
    path: row.path,
    project_id: row.project_id,
    parent_id: null,
    type: row.node_type,
    name: row.name,
    icon: null,
    created_at: row.indexed_at,
    updated_at: row.node_updated_at,
    deleted_at: null,
    last_opened_at: null,
    access_count: 0,
    tags: null,
    is_virtual: row.source !== 'workspace_node' && row.source !== 'resource_library',
    source: row.source,
  };
}

function readWorkspaceNodeIdFromInode(inode: string): string | null {
  const prefix = 'workspace:';
  return inode.startsWith(prefix) && inode.length > prefix.length
    ? inode.slice(prefix.length)
    : null;
}

function hasIndexedRowSnapshot(db: WorkspaceVfsDatabase, row: SearchIndexLineRow): boolean {
  const nodeId = readWorkspaceNodeIdFromInode(row.inode);
  return nodeId ? hasWorkspaceNodeTextSnapshot(db, nodeId) : false;
}

async function collectIndexableFiles(
  params: ListWorkspaceVfsNodesParams,
  startNode: WorkspaceVfsNode | null,
  maxVisitedNodes: number,
): Promise<{ readonly files: WorkspaceVfsNode[]; readonly visitedNodes: number; readonly truncated: boolean }> {
  if (startNode && startNode.type !== 'folder') {
    return { files: [startNode], visitedNodes: 1, truncated: false };
  }

  const files: WorkspaceVfsNode[] = [];
  const queue: Array<string | null> = [startNode ? startNode.id : null];
  let visitedNodes = 0;

  while (queue.length > 0) {
    const parentId = queue.shift() ?? null;
    const children = await listWorkspaceVfsNodes({ ...params, parentId });
    for (const child of children) {
      visitedNodes += 1;
      if (visitedNodes > maxVisitedNodes) {
        return { files, visitedNodes, truncated: true };
      }
      if (child.type === 'folder') {
        queue.push(child.id);
      } else {
        files.push(child);
      }
    }
  }

  return { files, visitedNodes, truncated: false };
}

function readFreshness(db: WorkspaceVfsDatabase, projectId: string, inode: string): SearchIndexFreshnessRow | null {
  const row = db.prepare(`
    SELECT content_hash, node_updated_at, path
    FROM workspace_vfs_search_lines
    WHERE project_id = ? AND inode = ?
    LIMIT 1
  `).get(projectId, inode) as SearchIndexFreshnessRow | undefined;
  return row ?? null;
}

function updateIndexedNodeSnapshot(db: WorkspaceVfsDatabase, node: WorkspaceVfsNode): void {
  db.prepare(`
    UPDATE workspace_vfs_search_lines
    SET path = ?, name = ?, node_type = ?, source = ?, node_updated_at = ?
    WHERE project_id = ? AND inode = ?
  `).run(node.path, node.name, node.type, node.source, node.updated_at, node.project_id, node.inode);
}

function deleteIndexedNode(db: WorkspaceVfsDatabase, projectId: string, inode: string): void {
  db.prepare(`
    DELETE FROM workspace_vfs_search_grams
    WHERE line_id IN (
      SELECT id FROM workspace_vfs_search_lines WHERE project_id = ? AND inode = ?
    )
  `).run(projectId, inode);
  db.prepare(`
    DELETE FROM workspace_vfs_search_lines
    WHERE project_id = ? AND inode = ?
  `).run(projectId, inode);
}

function readIndexedInodesInScope(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly startNode: WorkspaceVfsNode | null;
}): string[] {
  const pathPredicate = buildPathPredicate(params.startNode);
  const rows = params.db.prepare(`
    SELECT DISTINCT l.inode
    FROM workspace_vfs_search_lines l
    WHERE l.project_id = ?${pathPredicate.sql}
  `).all(
    params.projectId,
    ...pathPredicate.params,
  ) as SearchIndexInodeRow[];
  return rows.map((row) => row.inode);
}

function deleteStaleIndexedNodes(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly startNode: WorkspaceVfsNode | null;
  readonly liveInodes: ReadonlySet<string>;
}): void {
  for (const inode of readIndexedInodesInScope(params)) {
    if (!params.liveInodes.has(inode)) {
      deleteIndexedNode(params.db, params.projectId, inode);
    }
  }
}

function insertIndexedLines(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly node: WorkspaceVfsNode;
  readonly text: string;
  readonly contentHash: string;
  readonly indexedAt: number;
}): void {
  const contentKind = 'content';
  const lines = params.text.split(/\r?\n/);
  const insertLine = params.db.prepare(`
    INSERT INTO workspace_vfs_search_lines (
      id, project_id, inode, path, name, node_type, source, content_kind,
      line_no, text, text_lc, content_hash, node_updated_at, indexed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGram = params.db.prepare(`
    INSERT OR IGNORE INTO workspace_vfs_search_grams (project_id, gram, line_id)
    VALUES (?, ?, ?)
  `);

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (text.trim().length === 0) continue;
    const lineNo = index + 1;
    const lineId = hashLineId({
      projectId: params.node.project_id ?? '',
      inode: params.node.inode,
      contentKind,
      lineNo,
    });
    insertLine.run(
      lineId,
      params.node.project_id,
      params.node.inode,
      params.node.path,
      params.node.name,
      params.node.type,
      params.node.source,
      contentKind,
      lineNo,
      text,
      text.toLowerCase(),
      params.contentHash,
      params.node.updated_at,
      params.indexedAt,
    );

    for (const gram of buildUniqueTrigrams(text.toLowerCase())) {
      insertGram.run(params.node.project_id, gram, lineId);
    }
  }
}

async function ensureNodeIndexed(params: {
  readonly base: ListWorkspaceVfsNodesParams;
  readonly node: WorkspaceVfsNode;
  readonly maxFileChars: number;
}): Promise<{ readonly indexed: boolean; readonly skippedFresh: boolean; readonly truncatedFile: boolean }> {
  const projectId = params.node.project_id;
  if (!projectId) return { indexed: false, skippedFresh: true, truncatedFile: false };

  const existing = readFreshness(params.base.db, projectId, params.node.inode);
  if (existing && existing.node_updated_at === params.node.updated_at) {
    if (existing.path !== params.node.path) {
      updateIndexedNodeSnapshot(params.base.db, params.node);
    }
    return { indexed: false, skippedFresh: true, truncatedFile: false };
  }

  const read = await readWorkspaceVfsNode({
    ...params.base,
    inode: params.node.inode,
    maxChars: params.maxFileChars,
  });
  if (!read.ok) {
    deleteIndexedNode(params.base.db, projectId, params.node.inode);
    return { indexed: false, skippedFresh: false, truncatedFile: false };
  }

  deleteIndexedNode(params.base.db, projectId, params.node.inode);
  insertIndexedLines({
    db: params.base.db,
    node: read.node,
    text: read.text,
    contentHash: hashText(read.text),
    indexedAt: Date.now(),
  });

  return { indexed: true, skippedFresh: false, truncatedFile: read.truncated };
}

function buildPathPredicate(startNode: WorkspaceVfsNode | null): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  if (!startNode) {
    return { sql: '', params: [] };
  }

  if (startNode.type !== 'folder') {
    return { sql: ' AND l.path = ?', params: [startNode.path] };
  }

  return {
    sql: ' AND l.path LIKE ? ESCAPE \'\\\'',
    params: [`${escapeLike(startNode.path)}/%`],
  };
}

function queryCandidateRows(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly startNode: WorkspaceVfsNode | null;
  readonly patternComparable: string;
  readonly grams: readonly string[];
  readonly candidateLimit: number;
}): SearchIndexLineRow[] {
  const pathPredicate = buildPathPredicate(params.startNode);
  if (params.grams.length > 0) {
    const selectedGrams = params.grams.slice(0, MAX_QUERY_GRAMS);
    const placeholders = selectedGrams.map(() => '?').join(', ');
    return params.db.prepare(`
      SELECT
        l.id, l.project_id, l.inode, l.path, l.name, l.node_type, l.source, l.content_kind,
        l.line_no, l.text, l.text_lc, l.content_hash, l.node_updated_at, l.indexed_at
      FROM workspace_vfs_search_lines l
      JOIN (
        SELECT line_id
        FROM workspace_vfs_search_grams
        WHERE project_id = ? AND gram IN (${placeholders})
        GROUP BY line_id
        HAVING COUNT(DISTINCT gram) = ?
      ) c ON c.line_id = l.id
      WHERE l.project_id = ?${pathPredicate.sql}
      ORDER BY l.path ASC, l.line_no ASC
      LIMIT ?
    `).all(
      params.projectId,
      ...selectedGrams,
      selectedGrams.length,
      params.projectId,
      ...pathPredicate.params,
      params.candidateLimit,
    ) as SearchIndexLineRow[];
  }

  return params.db.prepare(`
    SELECT
      l.id, l.project_id, l.inode, l.path, l.name, l.node_type, l.source, l.content_kind,
      l.line_no, l.text, l.text_lc, l.content_hash, l.node_updated_at, l.indexed_at
    FROM workspace_vfs_search_lines l
    WHERE l.project_id = ?${pathPredicate.sql}
      AND l.text_lc LIKE ? ESCAPE '\\'
    ORDER BY l.path ASC, l.line_no ASC
    LIMIT ?
  `).all(
    params.projectId,
    ...pathPredicate.params,
    `%${escapeLike(params.patternComparable.toLowerCase())}%`,
    params.candidateLimit,
  ) as SearchIndexLineRow[];
}

export async function grepWorkspaceVfsSearchIndex(params: WorkspaceVfsIndexedGrepParams): Promise<WorkspaceVfsIndexedGrepResult> {
  const maxResults = clampPositiveInteger(params.maxResults, DEFAULT_MAX_RESULTS);
  const maxIndexedNodes = clampPositiveInteger(params.maxIndexedNodes, DEFAULT_MAX_INDEXED_NODES);
  const maxFileChars = clampPositiveInteger(params.maxFileChars, DEFAULT_MAX_FILE_CHARS);
  const compiled = compileWorkspaceSearchPattern({
    pattern: params.pattern,
    caseSensitive: params.caseSensitive,
  });

  let startNode: WorkspaceVfsNode | null = null;
  const isRootPath = params.path ? normalizeVfsPath(params.path) === '/' : false;
  if (params.inode || (params.path && !isRootPath)) {
    const resolved = await resolveWorkspaceVfsNode({ ...params, includeSystemNodes: true });
    if (resolved.ok) {
      startNode = resolved.node;
    } else {
      throw new Error(resolved.hint ? `${resolved.message} ${resolved.hint}` : resolved.message);
    }
  }

  const collected = await collectIndexableFiles(params, startNode, maxIndexedNodes);
  const liveInodes = new Set(collected.files.map((node) => node.inode));
  let indexedNodes = 0;
  let skippedFreshNodes = 0;
  let truncatedFiles = 0;

  for (const node of collected.files) {
    const result = await ensureNodeIndexed({
      base: params,
      node,
      maxFileChars,
    });
    if (result.indexed) indexedNodes += 1;
    if (result.skippedFresh) skippedFreshNodes += 1;
    if (result.truncatedFile) truncatedFiles += 1;
  }

  // 只有完整遍历了范围时才清理 stale index，避免在预算截断时误删尚未访问到的文件索引。
  if (!collected.truncated) {
    deleteStaleIndexedNodes({
      db: params.db,
      projectId: params.projectId,
      startNode,
      liveInodes,
    });
  }

  const candidateRows = queryCandidateRows({
    db: params.db,
    projectId: params.projectId,
    startNode,
    patternComparable: compiled.comparable,
    grams: compiled.grams,
    candidateLimit: Math.min(MAX_CANDIDATE_ROWS, Math.max(maxResults * 50, maxResults)),
  });

  const matches: WorkspaceVfsSearchMatch[] = [];
  const nodeTypeAccessPolicy = params.nodeTypeAccessPolicy;
  for (const row of candidateRows) {
    if (
      nodeTypeAccessPolicy &&
      !nodeTypeAccessPolicy.canReadContent(row.node_type) &&
      !hasIndexedRowSnapshot(params.db, row)
    ) {
      continue;
    }
    const match = findLiteralMatchInLine({
      text: row.text,
      compiled,
    });
    if (!match) continue;
    matches.push({
      node: buildIndexedNode(row),
      line: row.line_no,
      column: match.column,
      preview: match.preview,
    });
    if (matches.length >= maxResults) break;
  }

  return {
    ok: true,
    matches,
    truncated: matches.length >= maxResults || collected.truncated,
    index: {
      available: true,
      indexedNodes,
      skippedFreshNodes,
      visitedNodes: collected.visitedNodes,
      truncatedIndexing: collected.truncated,
      truncatedFiles,
    },
  };
}
