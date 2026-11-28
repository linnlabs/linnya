import type { DocumentPreviewContent } from '@app/schemas';
import type { DocumentPreviewCapability } from '@linnya/plugin-host-contract/backend/documentPreview';
export interface PreviewNode {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly nodeType: string;
  readonly deletedAt: number | null;
}
export interface DocumentPreviewCache {
  read(key: string): Promise<DocumentPreviewContent | null>;
  write(key: string, content: DocumentPreviewContent): Promise<void>;
}
/** 一档缩好的预览图；format 决定取回时的 MIME 类型。字节独占自己的缓冲区，跨进程传递时不会带出别的数据。 */
export interface PreviewImageVariant {
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly bytes: Uint8Array<ArrayBuffer>;
}
export interface PreviewImageVariantCache {
  read(key: string): Promise<PreviewImageVariant | null>;
  write(key: string, variant: PreviewImageVariant): Promise<void>;
}
export interface DocumentPreviewDependencies {
  readonly context: unknown;
  readonly readNode: (id: string) => PreviewNode | null;
  readonly readTextSnapshot: (id: string) => string | null;
  readonly resolveProvider: (nodeType: string) => DocumentPreviewCapability | null;
  readonly cache: DocumentPreviewCache;
}
