import type { Component } from 'vue';
import type {
  DocumentPreviewImageHandle,
  DocumentPreviewMountInput,
  RendererDocumentPreviewPort,
} from '@linnya/plugin-host-contract/renderer/documentPreview';
import {
  DocumentPreviewImageRequestSchema,
  DocumentPreviewImageResultSchema,
  DocumentPreviewTypesSchema,
  DocumentPreviewRequestSchema,
  DocumentPreviewResultSchema,
  type DocumentPreviewImageRequest,
  type DocumentPreviewImageResult,
  type DocumentPreviewRequest,
  type DocumentPreviewResult,
} from '@app/schemas';

function invoke(channel: string, parameters: readonly unknown[]): unknown {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document preview API unavailable');
  const method: unknown = Reflect.get(api, channel);
  if (typeof method !== 'function') throw new Error('Document preview API unavailable');
  return Reflect.apply(method, api, parameters);
}

/** 只开放只读预览，不将 Electron API 或数据库传给插件。 */
export async function readDocumentPreview(
  input: DocumentPreviewRequest
): Promise<DocumentPreviewResult> {
  return DocumentPreviewResultSchema.parse(
    await invoke('document-preview:read', [DocumentPreviewRequestSchema.parse(input)])
  );
}

/**
 * 预览正文里一张图片的一档字节。只给 Host 的图片共享层使用，不进插件导出表：
 * 插件经 acquireDocumentPreviewImage 拿地址，同一张图在各入口之间只取一次、只占一份内存。
 */
export async function readDocumentPreviewImage(
  input: DocumentPreviewImageRequest
): Promise<DocumentPreviewImageResult> {
  return DocumentPreviewImageResultSchema.parse(
    await invoke('document-preview:read-image', [DocumentPreviewImageRequestSchema.parse(input)])
  );
}

export async function listDocumentPreviewTypes() {
  return DocumentPreviewTypesSchema.parse(await invoke('document-preview:types', []));
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
export function mountDocumentPreview(input: DocumentPreviewMountInput): Promise<() => void> {
  if (!rendererPort) throw new Error('Document preview renderer port is not installed');
  return rendererPort.mount(input);
}
/** 取到的地址在 release 之前有效；用完必须 release，最后一个使用方释放后图片才离开内存。 */
export function acquireDocumentPreviewImage(
  input: DocumentPreviewImageRequest
): Promise<DocumentPreviewImageHandle> {
  if (!rendererPort) throw new Error('Document preview renderer port is not installed');
  return rendererPort.acquireImage(input);
}
export type {
  DocumentPreviewImageHandle,
  DocumentPreviewMountInput,
  RendererDocumentPreviewPort,
} from '@linnya/plugin-host-contract/renderer/documentPreview';
