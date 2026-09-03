/**
 * @file workspaceVfsRead.ts
 * @description Workspace Path Layer 的读取、搜索和错误契约。
 */

import type { WorkspaceVfsNode } from './workspaceVfsNode';
import type { DocumentCitationProjection } from '../../../../domains/citation';

/** 具体插件可以贡献自己的媒体类型；Core 不维护插件 MIME 白名单。 */
export type WorkspaceVfsContentType = string;

export type WorkspaceVfsErrorCode =
  | 'ENOENT'
  | 'EPERM'
  | 'EINVAL'
  | 'E2BIG'
  | 'EISDIR'
  | 'ENOTFILE';

export interface WorkspaceVfsError {
  readonly ok: false;
  readonly error_code: WorkspaceVfsErrorCode;
  readonly message: string;
  readonly hint?: string;
}

export interface WorkspaceVfsReadSuccess {
  readonly ok: true;
  readonly node: WorkspaceVfsNode;
  readonly contentType: WorkspaceVfsContentType;
  readonly text: string;
  readonly truncated: boolean;
  readonly metadata?: Record<string, unknown>;
  /** 仅 Markdown 文档读取携带；调用方必须按自己的最终正文窗口收窄后才能进入 wire。 */
  readonly citationProjection?: DocumentCitationProjection;
}

export type WorkspaceVfsReadResult = WorkspaceVfsReadSuccess | WorkspaceVfsError;

export interface WorkspaceVfsSearchMatch {
  readonly node: WorkspaceVfsNode;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface WorkspaceVfsSearchIndexMetadata {
  readonly available: true;
  readonly indexedNodes: number;
  readonly skippedFreshNodes: number;
  readonly visitedNodes: number;
  readonly truncatedIndexing: boolean;
  readonly truncatedFiles: number;
}

export interface WorkspaceVfsSearchSuccess {
  readonly ok: true;
  readonly matches: WorkspaceVfsSearchMatch[];
  readonly truncated: boolean;
  readonly index?: WorkspaceVfsSearchIndexMetadata;
}

export type WorkspaceVfsSearchResult = WorkspaceVfsSearchSuccess | WorkspaceVfsError;
