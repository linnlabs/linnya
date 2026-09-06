/**
 * @file documentTypeBackendHook.ts
 * @description 后端文档类型 hook 契约与注册表。
 *
 * 中文说明：
 * - 通用 Workspace 工具 / VFS 只能认识“文档类型能力”，不能 import 某个插件的实现；
 * - 插件通过 backend contribution 注册 hook，平台侧按 docType 查询；
 * - enabled 过滤必须在注册表层执行，避免禁用插件后仍能通过通用工具读写该类型内容。
 */

import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import type {
  DocumentTypeBackendCreateObservationParams,
  DocumentTypeBackendCreateResult,
  DocumentTypeBackendDatabase,
  DocumentTypeBackendDuplicateResult,
  DocumentTypeBackendEditorReadParams,
  DocumentTypeBackendEditorReadResult,
  DocumentTypeBackendEditorWriteParams,
  DocumentTypeBackendEditorWriteResult,
  DocumentTypeBackendProjectCharCountParams,
  DocumentTypeBackendReadDatabase,
  DocumentTypeBackendReadParams,
  DocumentTypeBackendReadResult,
  DocumentTypeBackendSystemViewSpec,
  DocumentTypeBackendToolReadData,
  DocumentTypeBackendToolReadResult,
  DocumentTypeBackendWriteObservationParams,
  DocumentTypeBackendWriteOperation,
  DocumentTypeBackendWriteResult,
} from '@linnya/plugin-host-contract/backend/documentTypeBackendHook';

export type {
  DocumentTypeBackendContentType,
  DocumentTypeBackendCreateObservationParams,
  DocumentTypeBackendCreateResult,
  DocumentTypeBackendDatabase,
  DocumentTypeBackendDuplicateResult,
  DocumentTypeBackendEditorReadParams,
  DocumentTypeBackendEditorReadResult,
  DocumentTypeBackendEditorWriteParams,
  DocumentTypeBackendEditorWriteResult,
  DocumentTypeBackendProjectCharCountParams,
  DocumentTypeBackendReadDatabase,
  DocumentTypeBackendReadParams,
  DocumentTypeBackendReadResult,
  DocumentTypeBackendStatement,
  DocumentTypeBackendSystemViewSpec,
  DocumentTypeBackendToolReadData,
  DocumentTypeBackendToolReadResult,
  DocumentTypeBackendTransaction,
  DocumentTypeBackendWriteObservationParams,
  DocumentTypeBackendWriteOperation,
  DocumentTypeBackendWriteResult,
  DocumentTypeDiagnostic,
  DocumentTypeDiagnosticSeverity,
} from '@linnya/plugin-host-contract/backend/documentTypeBackendHook';

export interface DocumentTypeBackendCreateParams {
  readonly context: PluginToolContext;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly content?: string;
}

export interface DocumentTypeBackendWriteParams {
  readonly context: PluginToolContext;
  readonly projectId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly content: string;
  /** edit_file 从当前 VFS 文本投影读到的稳定源版本身份。 */
  readonly expectedSourceKey?: string;
}

export interface DocumentTypeBackendDuplicateParams {
  readonly context: PluginToolContext;
  readonly sourceDocumentId: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface DocumentTypeBackendToolReadParams {
  readonly context: PluginToolContext;
  /**
   * 工具原始参数。
   *
   * 中文说明：
   * - 通用读取工具仍只认识文档类型 hook；
   * - 部分重型文档有参数化读取能力，
   *   这些参数必须透传给插件 hook，避免 host 为某个插件保留专属分支。
   */
  readonly args?: Readonly<Record<string, unknown>>;
  readonly documentId: string;
  readonly documentName: string;
  readonly maxChars: number;
  readonly offsetChars: number;
  readonly structureOnly: boolean;
}

export interface DocumentTypeBackendHook {
  readonly history?: import('@linnya/plugin-host-contract/backend/documentHistory').DocumentHistoryCapability;
  readonly docType: string;
  readonly displayName: string;
  readonly fileExtension?: string;
  readonly fileExtensions?: readonly string[];
  readonly systemView?: DocumentTypeBackendSystemViewSpec;
  readonly systemViews?: readonly DocumentTypeBackendSystemViewSpec[];
  readonly isEnabled?: () => boolean;
  readonly formatCreateObservation?: (params: DocumentTypeBackendCreateObservationParams) => string;
  readonly formatWriteObservation?: (params: DocumentTypeBackendWriteObservationParams) => string;
  readonly createDocument?: (
    params: DocumentTypeBackendCreateParams
  ) => Promise<DocumentTypeBackendCreateResult> | DocumentTypeBackendCreateResult;
  readonly writeDocument?: (
    params: DocumentTypeBackendWriteParams
  ) => Promise<DocumentTypeBackendWriteResult> | DocumentTypeBackendWriteResult;
  readonly readEditorDocument?: (
    params: DocumentTypeBackendEditorReadParams
  ) => DocumentTypeBackendEditorReadResult | null;
  readonly writeEditorDocument?: (
    params: DocumentTypeBackendEditorWriteParams
  ) => DocumentTypeBackendEditorWriteResult;
  readonly duplicateDocument?: (
    params: DocumentTypeBackendDuplicateParams
  ) =>
    | Promise<DocumentTypeBackendDuplicateResult | null>
    | DocumentTypeBackendDuplicateResult
    | null;
  readonly readDocument?: (
    params: DocumentTypeBackendToolReadParams
  ) => Promise<DocumentTypeBackendToolReadResult | null> | DocumentTypeBackendToolReadResult | null;
  readonly readVfsContent?: (
    params: DocumentTypeBackendReadParams
  ) => DocumentTypeBackendReadResult | null;
  readonly readProjectCharCount?: (params: DocumentTypeBackendProjectCharCountParams) => number;
}

export interface DocumentTypeBackendHookLookupOptions {
  readonly includeDisabled?: boolean;
}

const hooks = new Map<string, DocumentTypeBackendHook>();

function isHookEnabled(hook: DocumentTypeBackendHook): boolean {
  return hook.isEnabled ? hook.isEnabled() : true;
}

export function registerDocumentTypeBackendHook(hook: DocumentTypeBackendHook): void {
  if (hooks.has(hook.docType)) {
    throw new Error(`[doc-type-hook] 重复注册文档类型 hook: ${hook.docType}`);
  }
  hooks.set(hook.docType, hook);
}

export function unregisterDocumentTypeBackendHook(
  docType: string,
  expectedHook?: DocumentTypeBackendHook
): boolean {
  const currentHook = hooks.get(docType);
  if (!currentHook) {
    return false;
  }
  if (expectedHook && currentHook !== expectedHook) {
    return false;
  }
  hooks.delete(docType);
  return true;
}

export function getDocumentTypeBackendHook(
  docType: string,
  options: DocumentTypeBackendHookLookupOptions = {}
): DocumentTypeBackendHook | undefined {
  const hook = hooks.get(docType);
  if (!hook) return undefined;
  if (!options.includeDisabled && !isHookEnabled(hook)) return undefined;
  return hook;
}

export function listDocumentTypeBackendHooks(
  options: DocumentTypeBackendHookLookupOptions = {}
): DocumentTypeBackendHook[] {
  return Array.from(hooks.values()).filter(hook => options.includeDisabled || isHookEnabled(hook));
}

export function listDocumentTypeBackendSystemViewSpecs(
  hook: DocumentTypeBackendHook
): DocumentTypeBackendSystemViewSpec[] {
  return [...(hook.systemView ? [hook.systemView] : []), ...(hook.systemViews ?? [])];
}
