/**
 * @file workspaceVfsSearchIndex.ts
 * @description Workspace Path Layer 的行级 grep 搜索索引（SQLite FTS5 trigram 候选 + JS 字面量确认）。
 */

import { SEARCH_INDEX_VERSION, SearchIndexFreshnessSchema, type SearchIndexFreshnessRow } from '../definitions/workspaceVfsSearchIndex';
import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import {
  WORKSPACE_VFS_DIRECTORY_SEARCH_MAX_FILE_CHARS,
  type WorkspaceVfsReadSuccess,
  type WorkspaceVfsSearchIndexMetadata,
  type WorkspaceVfsSearchMatch,
} from '../definitions/workspaceVfsRead';
import {
  buildShortPatternCaseVariants,
  buildTrigramMatchExpression,
  compileWorkspaceSearchPattern,
  findLiteralMatchInLine,
  type CompiledWorkspaceSearchPattern,
} from '../functions/searchPattern';
import { normalizeVfsPath } from '../functions/pathSegments';
import type { ListWorkspaceVfsNodesParams, WorkspaceVfsDatabase } from './listWorkspaceVfsNodes';
import { collectWorkspaceVfsSearchFiles } from './collectWorkspaceVfsSearchFiles';
import { readWorkspaceVfsNode } from './readWorkspaceVfsNode';
import { resolveWorkspaceVfsNode } from './resolveWorkspaceVfsNode';
import { hasWorkspaceNodeTextSnapshot } from '../../infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_INDEXED_NODES = 5000;
const MAX_QUERY_GRAMS = 16;
const MAX_CANDIDATE_ROWS = 5000;
const MAX_DELETE_BATCH_SIZE = 400;

interface SearchIndexCandidateRow {
  readonly inode: string;
  readonly line_no: number;
  readonly text: string;
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
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'workspace_vfs_search_index_files', 'workspace_vfs_search_index_lines', 'workspace_vfs_search_index_fts'
    )
  `).all();
  return tables.length === 3;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (matched) => `\\${matched}`);
}

function readWorkspaceNodeIdFromInode(inode: string): string | null {
  const prefix = 'workspace:';
  return inode.startsWith(prefix) && inode.length > prefix.length
    ? inode.slice(prefix.length)
    : null;
}

function hasIndexedTextSnapshot(db: WorkspaceVfsDatabase, inode: string): boolean {
  const nodeId = readWorkspaceNodeIdFromInode(inode);
  return nodeId ? hasWorkspaceNodeTextSnapshot(db, nodeId) : false;
}

/** 索引写入只能整体生效；savepoint 复用当前连接，也不会提交调用方外层事务。 */
function runInSearchIndexSavepoint<T>(db: WorkspaceVfsDatabase, name: string, write: () => T): T {
  db.prepare(`SAVEPOINT ${name}`).run();
  try {
    const result = write();
    db.prepare(`RELEASE SAVEPOINT ${name}`).run();
    return result;
  } catch (error) {
    try {
      db.prepare(`ROLLBACK TO SAVEPOINT ${name}`).run();
      db.prepare(`RELEASE SAVEPOINT ${name}`).run();
    } catch (rollbackError) {
      // 数据库 I/O 等异常可能同时破坏事务；保留两项原始错误，不能用清理异常覆盖写入原因。
      throw Object.assign(new Error('Workspace search index rollback failed.'), { cause: error, rollbackError });
    }
    throw error;
  }
}

function readFreshness(db: WorkspaceVfsDatabase, projectId: string, inode: string): SearchIndexFreshnessRow | null {
  const row = db.prepare(`
    SELECT node_updated_at, path, index_version, max_file_chars, truncated
    FROM workspace_vfs_search_index_files
    WHERE project_id = ? AND inode = ?
  `).get(projectId, inode);
  return row === undefined ? null : SearchIndexFreshnessSchema.parse(row);
}

function updateIndexedPath(db: WorkspaceVfsDatabase, node: WorkspaceVfsNode): void {
  db.prepare(`
    UPDATE workspace_vfs_search_index_files SET path = ?
    WHERE project_id = ? AND inode = ?
  `).run(node.path, node.project_id, node.inode);
}

/**
 * 撤回文件的覆盖记录与全部索引行；FTS5 倒排项由行表触发器同步撤回。
 * 行和覆盖记录在同一个 savepoint 中删除，不能留下“有覆盖记录但没有行”的假新鲜索引。
 */
export function deleteWorkspaceVfsSearchIndexEntries(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly inodes: readonly string[];
}): void {
  if (params.inodes.length === 0) return;
  runInSearchIndexSavepoint(params.db, 'workspace_vfs_search_delete', () => {
    for (let offset = 0; offset < params.inodes.length; offset += MAX_DELETE_BATCH_SIZE) {
      const inodes = params.inodes.slice(offset, offset + MAX_DELETE_BATCH_SIZE);
      const placeholders = inodes.map(() => '?').join(', ');
      params.db.prepare(`
        DELETE FROM workspace_vfs_search_index_lines
        WHERE file_id IN (
          SELECT id FROM workspace_vfs_search_index_files
          WHERE project_id = ? AND inode IN (${placeholders})
        )
      `).run(params.projectId, ...inodes);
      params.db.prepare(`
        DELETE FROM workspace_vfs_search_index_files
        WHERE project_id = ? AND inode IN (${placeholders})
      `).run(params.projectId, ...inodes);
    }
  });
}

function readIndexedInodesInScope(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly startNode: WorkspaceVfsNode | null;
}): string[] {
  const pathPredicate = buildPathPredicate(params.startNode);
  const rows = params.db.prepare(`
    SELECT f.inode
    FROM workspace_vfs_search_index_files f
    WHERE f.project_id = ?${pathPredicate.sql}
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
  deleteWorkspaceVfsSearchIndexEntries({
    db: params.db,
    projectId: params.projectId,
    inodes: readIndexedInodesInScope(params).filter((inode) => !params.liveInodes.has(inode)),
  });
}

function insertIndexedFile(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly read: WorkspaceVfsReadSuccess;
  readonly maxFileChars: number;
}): number {
  const row = params.db.prepare(`
    INSERT INTO workspace_vfs_search_index_files (
      project_id, inode, path, node_updated_at, index_version, max_file_chars, truncated
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(params.projectId, params.read.node.inode, params.read.node.path, params.read.node.updated_at,
    SEARCH_INDEX_VERSION, params.maxFileChars, params.read.truncated ? 1 : 0) as { readonly id: number } | undefined;
  if (!row || !Number.isSafeInteger(row.id)) {
    throw new Error('Workspace search index file id was not returned.');
  }
  return row.id;
}

function insertIndexedLines(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly fileId: number;
  readonly text: string;
}): void {
  const lines = params.text.split(/\r?\n/);
  const insertLine = params.db.prepare(`
    INSERT INTO workspace_vfs_search_index_lines (file_id, line_no, text)
    VALUES (?, ?, ?)
  `);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (text.trim().length === 0) continue;
    insertLine.run(params.fileId, index + 1, text);
  }
}

/** 异步正文投影完成后才进入同步批写；每个文件的行、FTS 倒排项和覆盖记录一起提交。 */
function replaceIndexedNode(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly read: WorkspaceVfsReadSuccess;
  readonly maxFileChars: number;
}): void {
  const { db, projectId, read } = params;
  runInSearchIndexSavepoint(db, 'workspace_vfs_search_rebuild', () => {
    deleteWorkspaceVfsSearchIndexEntries({ db, projectId, inodes: [read.node.inode] });
    const fileId = insertIndexedFile({ db, projectId, read, maxFileChars: params.maxFileChars });
    insertIndexedLines({ db, fileId, text: read.text });
  });
}

async function ensureNodeIndexed(params: {
  readonly base: ListWorkspaceVfsNodesParams;
  readonly node: WorkspaceVfsNode;
  readonly maxFileChars: number;
}): Promise<{ readonly indexed: boolean; readonly skippedFresh: boolean; readonly truncatedFile: boolean; readonly incomplete: boolean }> {
  const projectId = params.node.project_id;
  if (!projectId) return { indexed: false, skippedFresh: false, truncatedFile: false, incomplete: true };

  const existing = readFreshness(params.base.db, projectId, params.node.inode);
  if (existing && existing.index_version === SEARCH_INDEX_VERSION &&
    existing.max_file_chars === params.maxFileChars &&
    existing.node_updated_at === params.node.updated_at) {
    if (existing.path !== params.node.path) {
      updateIndexedPath(params.base.db, params.node);
    }
    return {
      indexed: false, skippedFresh: true,
      truncatedFile: existing.truncated === 1, incomplete: existing.truncated === 1,
    };
  }

  const read = await readWorkspaceVfsNode({
    ...params.base,
    inode: params.node.inode,
    maxChars: params.maxFileChars,
  });
  if (!read.ok) {
    deleteWorkspaceVfsSearchIndexEntries({ db: params.base.db, projectId, inodes: [params.node.inode] });
    return { indexed: false, skippedFresh: false, truncatedFile: false, incomplete: true };
  }

  replaceIndexedNode({ db: params.base.db, projectId, read, maxFileChars: params.maxFileChars });

  return { indexed: true, skippedFresh: false, truncatedFile: read.truncated, incomplete: read.truncated };
}

function buildPathPredicate(startNode: WorkspaceVfsNode | null): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  if (!startNode) {
    return { sql: '', params: [] };
  }

  if (startNode.type !== 'folder') {
    return { sql: ' AND f.path = ?', params: [startNode.path] };
  }

  return {
    sql: ' AND f.path LIKE ? ESCAPE \'\\\'',
    params: [`${escapeLike(startNode.path)}/%`],
  };
}

function buildShortPatternPredicate(compiled: CompiledWorkspaceSearchPattern): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  if (compiled.caseSensitive) {
    return { sql: 'instr(l.text, ?) > 0', params: [compiled.raw] };
  }
  const variants = buildShortPatternCaseVariants(compiled.raw);
  return {
    sql: `(${variants.map(() => "l.text LIKE ? ESCAPE '\\'").join(' OR ')})`,
    params: variants.map((variant) => `%${escapeLike(variant)}%`),
  };
}

/**
 * 三字及以上：FTS5 trigram 倒排表给出同时含有这些三字组的行；不足三字：在范围内扫描行表。
 * 两条路径都只产出候选，最终命中由调用方用 JS 字面量比较确认。
 */
function queryCandidateRows(params: {
  readonly db: WorkspaceVfsDatabase;
  readonly projectId: string;
  readonly startNode: WorkspaceVfsNode | null;
  readonly compiled: CompiledWorkspaceSearchPattern;
  readonly candidateLimit: number;
}): SearchIndexCandidateRow[] {
  const pathPredicate = buildPathPredicate(params.startNode);
  const scopeSql = `f.project_id = ? AND f.index_version = ${SEARCH_INDEX_VERSION}${pathPredicate.sql}`;
  if (params.compiled.grams.length > 0) {
    return params.db.prepare(`
      SELECT f.inode, l.line_no, l.text
      FROM workspace_vfs_search_index_fts
      JOIN workspace_vfs_search_index_lines l ON l.id = workspace_vfs_search_index_fts.rowid
      JOIN workspace_vfs_search_index_files f ON f.id = l.file_id
      WHERE workspace_vfs_search_index_fts MATCH ? AND ${scopeSql}
      ORDER BY f.path ASC, l.line_no ASC
      LIMIT ?
    `).all(
      buildTrigramMatchExpression(params.compiled.grams.slice(0, MAX_QUERY_GRAMS)),
      params.projectId,
      ...pathPredicate.params,
      params.candidateLimit,
    ) as SearchIndexCandidateRow[];
  }

  const textPredicate = buildShortPatternPredicate(params.compiled);
  return params.db.prepare(`
    SELECT f.inode, l.line_no, l.text
    FROM workspace_vfs_search_index_files f
    JOIN workspace_vfs_search_index_lines l ON l.file_id = f.id
    WHERE ${scopeSql} AND ${textPredicate.sql}
    ORDER BY f.path ASC, l.line_no ASC
    LIMIT ?
  `).all(
    params.projectId,
    ...pathPredicate.params,
    ...textPredicate.params,
    params.candidateLimit,
  ) as SearchIndexCandidateRow[];
}

export async function grepWorkspaceVfsSearchIndex(params: WorkspaceVfsIndexedGrepParams): Promise<WorkspaceVfsIndexedGrepResult> {
  const maxResults = clampPositiveInteger(params.maxResults, DEFAULT_MAX_RESULTS);
  const maxIndexedNodes = clampPositiveInteger(params.maxIndexedNodes, DEFAULT_MAX_INDEXED_NODES);
  const maxFileChars = clampPositiveInteger(params.maxFileChars, WORKSPACE_VFS_DIRECTORY_SEARCH_MAX_FILE_CHARS);
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

  const collected = await collectWorkspaceVfsSearchFiles(params, startNode, maxIndexedNodes);
  const liveNodes = new Map(collected.files.map((node) => [node.inode, node]));
  const liveInodes = new Set(liveNodes.keys());
  let indexedNodes = 0;
  let skippedFreshNodes = 0;
  let truncatedFiles = 0;
  let incompleteFiles = false;

  for (const node of collected.files) {
    const result = await ensureNodeIndexed({
      base: params,
      node,
      maxFileChars,
    });
    if (result.indexed) indexedNodes += 1;
    if (result.skippedFresh) skippedFreshNodes += 1;
    if (result.truncatedFile) truncatedFiles += 1;
    if (result.incomplete) incompleteFiles = true;
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

  const candidateLimit = Math.min(MAX_CANDIDATE_ROWS, Math.max(maxResults * 50, maxResults));
  const candidateRows = queryCandidateRows({
    db: params.db,
    projectId: params.projectId,
    startNode,
    compiled,
    candidateLimit: candidateLimit + 1,
  });

  const matches: WorkspaceVfsSearchMatch[] = [];
  const nodeTypeAccessPolicy = params.nodeTypeAccessPolicy;
  for (const row of candidateRows.slice(0, candidateLimit)) {
    // 未遍历的旧记录没有经过本次 freshness 检查，不把它们作为当前文件的命中。
    const node = liveNodes.get(row.inode);
    if (!node) continue;
    if (
      nodeTypeAccessPolicy &&
      !nodeTypeAccessPolicy.canReadContent(node.type) &&
      !hasIndexedTextSnapshot(params.db, row.inode)
    ) {
      continue;
    }
    const match = findLiteralMatchInLine({
      text: row.text,
      compiled,
    });
    if (!match) continue;
    matches.push({
      node,
      line: row.line_no,
      column: match.column,
      preview: match.preview,
    });
    if (matches.length > maxResults) break;
  }

  return {
    ok: true,
    matches: matches.slice(0, maxResults),
    truncated: matches.length > maxResults || collected.truncated || incompleteFiles || candidateRows.length > candidateLimit,
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
