import type { Ref } from 'vue';
import type { JsonValue } from '@app/schemas';
import type {
  CanvasCardId,
  CanvasRectangle,
  CanvasTextCardSchema,
  CanvasTextDocument,
} from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { CanvasDocumentSession } from '../../canvasDocument';

export interface CanvasTextEditingLease {
  readonly documentId: string;
  readonly elementId: CanvasCardId;
  readonly owner: string;
}
export interface CanvasCardDraft {
  readonly elementId: CanvasCardId;
  readonly content: CanvasTextDocument;
  readonly baseRevision: number;
  readonly editSequence: number;
  readonly savedSequence: number;
  readonly historyGroupId: string;
  readonly measuredHeight: number | null;
  readonly placement: CanvasRectangle;
}
export interface CanvasCardEditingState {
  readonly draft: Readonly<Ref<CanvasCardDraft | null>>;
  readonly saving: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  begin(card: z.infer<typeof CanvasTextCardSchema>, historyGroupId: string): void;
  update(content: CanvasTextDocument): void;
  measure(height: number): void;
  beginSave(): void;
  saved(baseRevision: number, savedSequence: number): void;
  failed(message: string): void;
  clear(): void;
}
export interface CanvasCardEditor {
  readonly state: CanvasCardEditingState;
  open(elementId: CanvasCardId, historyGroupId?: string, signal?: AbortSignal): Promise<void>;
  update(content: JsonValue): void;
  setComposing(value: boolean): void;
  measure(height: number): void;
  save(finish?: boolean): Promise<boolean>;
  suspend(): Promise<void>;
  dispose(): void;
}
export interface CanvasCardSaveOptions {
  readonly session: CanvasDocumentSession;
  readonly state: CanvasCardEditingState;
  readonly readLease: () => CanvasTextEditingLease | null;
  readonly owns: (lease: CanvasTextEditingLease | null, draft: CanvasCardDraft) => boolean;
  readonly finishDraft: (draft: CanvasCardDraft, mayFinish: () => boolean) => Promise<boolean>;
  readonly isComposing: () => boolean;
  readonly captureCurrent: () => () => boolean;
}
/** 打开流程可绑定自己的世代；对外编辑器仍只暴露finish参数。 */
export type CanvasCardSave = (finish?: boolean, isCurrent?: () => boolean) => Promise<boolean>;
