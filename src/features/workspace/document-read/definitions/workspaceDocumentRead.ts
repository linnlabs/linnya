/**
 * @file workspaceDocumentRead.ts
 * @description Workspace DocumentView 读取 feature 的请求、结果别名与窗口常量
 *
 * 被主 Tool 文件和各文档类型读取器共同依赖。
 */

import type {
  WorkspaceDocumentReadData,
  WorkspaceDocumentReadResult,
} from '@app/schemas';

/**
 * 文档读取结果的结构化数据
 * 与 DocumentView 头部字段保持一致，并补充少量对 Agent 友好的元信息。
 */
export type WorkspaceReadContentData = WorkspaceDocumentReadData;

export interface WorkspaceDocumentReadRequest {
  readonly documentId: string;
  readonly viewMode: 'preview' | 'base';
  readonly maxChars: number;
  readonly offsetChars: number;
  readonly structureOnly: boolean;
  /** 文档类型 hook 可消费的领域参数；Host 不解释插件私有字段。 */
  readonly pluginArgs?: Readonly<Record<string, unknown>>;
}

export interface WorkspaceDocumentTypeReadRequest extends WorkspaceDocumentReadRequest {
  readonly documentName: string;
}

export type WorkspaceDocumentTypeReadResult = Omit<
  WorkspaceDocumentReadResult,
  'observationPreviewMeta'
>;

/** Host 把永久内建文档和插件 hook 都收窄为这一读取合同。 */
export interface WorkspaceDocumentTypeReadProvider {
  readonly displayName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  readonly read: (
    request: WorkspaceDocumentTypeReadRequest,
  ) => Promise<WorkspaceDocumentTypeReadResult | null>;
}

export type WorkspaceDocumentTypeReadProviderResolver = (
  docType: string,
) => WorkspaceDocumentTypeReadProvider | undefined;

/** 默认返回的最大字符数 */
export const DEFAULT_MAX_CHARS = 4000;
/** 允许的最大字符数上限 */
export const MAX_ALLOWED_CHARS = 12000;
