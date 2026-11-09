import type { Component } from 'vue';
import type {
  DocumentPreviewMountInput,
  RendererDocumentPreviewPort,
} from '@linnya/plugin-host-contract/renderer/documentPreview';
import {
  DocumentPreviewTypesSchema,
  DocumentPreviewRequestSchema,
  DocumentPreviewResultSchema,
  type DocumentPreviewRequest,
  type DocumentPreviewResult,
} from '@app/schemas';

/** 只开放只读预览，不将 Electron API 或数据库传给插件。 */
export async function readDocumentPreview(
  input: DocumentPreviewRequest
): Promise<DocumentPreviewResult> {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document preview API unavailable');
  const read: unknown = Reflect.get(api, 'document-preview:read');
  if (typeof read !== 'function') throw new Error('Document preview API unavailable');
  const result: unknown = await Reflect.apply(read, api, [
    DocumentPreviewRequestSchema.parse(input),
  ]);
  return DocumentPreviewResultSchema.parse(result);
}

export async function listDocumentPreviewTypes() {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document preview API unavailable');
  const list: unknown = Reflect.get(api, 'document-preview:types');
  if (typeof list !== 'function') throw new Error('Document preview API unavailable');
  return DocumentPreviewTypesSchema.parse(await Reflect.apply(list, api, []));
}

let rendererPort: RendererDocumentPreviewPort | null = null;
export function registerRendererDocumentPreviewPort(port: RendererDocumentPreviewPort): void {
  rendererPort = port;
}
/** 预览卡片标出文档类型时用，与文件树同一图标；Host 端口未安装时返回 null。 */
export function readDocumentPreviewTypeIcon(nodeType: string): Component | null {
  return rendererPort?.readTypeIcon?.(nodeType) ?? null;
}
/** DOM只留在可信Renderer，不经IPC，也不让插件读取App store或文档类型正文DTO。 */
export function mountDocumentPreview(
  input: DocumentPreviewMountInput
): Promise<() => void> {
  if (!rendererPort) throw new Error('Document preview renderer port is not installed');
  return rendererPort.mount(input);
}
export type {
  DocumentPreviewMountInput,
  RendererDocumentPreviewPort,
} from '@linnya/plugin-host-contract/renderer/documentPreview';
