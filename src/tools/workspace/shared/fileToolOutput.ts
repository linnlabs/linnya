/**
 * @file fileToolOutput.ts
 * @description 文件工具输出格式化。
 */

import type {
  WorkspaceFileDocumentAlias,
  WorkspaceFileEntry,
  WorkspaceGrepMatch,
} from '@app/schemas';
import type { WorkspaceVfsNode } from '../../../features/workspace/vfs/definitions/workspaceVfsNode';
import { formatWorkspaceFileLocator } from '@app/schemas';

export type FileToolEntry = WorkspaceFileEntry;
export type FileToolDocumentAlias = WorkspaceFileDocumentAlias;

export function toFileToolEntry(node: WorkspaceVfsNode): FileToolEntry {
  return {
    name: node.name,
    locator: formatWorkspaceFileLocator(node.path),
    inode: node.inode,
    type: node.type,
    source: node.source,
    is_virtual: node.is_virtual,
    parent_id: node.parent_id,
    updated_at: node.updated_at,
  };
}

export function toDocumentAlias(node: WorkspaceVfsNode): FileToolDocumentAlias {
  return {
    id: node.id,
    title: node.name,
    type: node.type,
    parentId: node.parent_id,
    locator: formatWorkspaceFileLocator(node.path),
    inode: node.inode,
  };
}

export function formatEntriesObservation(params: {
  readonly label: string;
  readonly entries: readonly FileToolEntry[];
  readonly totalCount: number;
  readonly offset: number;
  readonly hasMore: boolean;
}): string {
  if (params.entries.length === 0) {
    return `${params.label} 下没有可见条目。`;
  }

  const paginationHint = params.hasMore
    ? `（共 ${params.totalCount} 个，当前第 ${params.offset + 1}-${params.offset + params.entries.length} 个，还有更多）`
    : `（共 ${params.totalCount} 个）`;
  const lines = params.entries.map((entry) => {
    const kind = entry.type === 'folder' ? 'dir' : 'file';
    return `${kind}\t${entry.locator}\t${entry.inode}`;
  });

  return [`${params.label} ${paginationHint}:`, ...lines].join('\n');
}

export type FileToolGrepMatch = WorkspaceGrepMatch;

export function formatGrepObservation(params: {
  readonly pattern: string;
  readonly matches: readonly FileToolGrepMatch[];
  readonly truncated: boolean;
}): string {
  const lines = params.matches.length === 0
    ? [`grep: ${params.truncated ? '在已搜索范围内未找到' : '未找到'} "${params.pattern}"。`]
    : params.matches.map((match) =>
      `${match.locator}:${match.line}:${match.column}: ${match.preview}`
    );
  if (params.truncated) {
    lines.push('[搜索或结果不完整，不能据此认定其余内容没有匹配。目录搜索受文件前缀、节点和候选预算限制，读取失败也会留下缺口。请指定具体文件 locator/inode 搜索全文；命中过多时提高 max_results。]');
  }
  return lines.join('\n');
}
