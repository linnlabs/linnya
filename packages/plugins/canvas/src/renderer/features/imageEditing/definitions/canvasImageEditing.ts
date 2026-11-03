import type { Ref } from 'vue';
import type { DocumentImageAsset } from '@app/schemas';
import type { CanvasImageCardSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
export type CanvasImageCard = z.infer<typeof CanvasImageCardSchema>;
export type CanvasImageCrop = NonNullable<CanvasImageCard['data']['crop']>;
export interface CanvasImageDraft {
  readonly card: CanvasImageCard;
  readonly data: CanvasImageCard['data'];
  readonly asset: DocumentImageAsset | null;
}
export interface CanvasImageEditingState {
  readonly draft: Readonly<Ref<CanvasImageDraft | null>>;
  readonly busy: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  begin(card: CanvasImageCard): void;
  patch(data: Partial<CanvasImageCard['data']>): void;
  installAsset(asset: DocumentImageAsset, data: CanvasImageCard['data']): void;
  setBusy(value: boolean): void;
  fail(message: string): void;
  clear(): void;
}
export interface CanvasImageEditingPort {
  readImage(documentId: string, assetId: string): Promise<DocumentImageAsset>;
  prepare(file: File): Promise<DocumentImageAsset>;
}
