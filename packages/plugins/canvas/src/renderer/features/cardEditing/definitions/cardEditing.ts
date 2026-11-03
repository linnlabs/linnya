import type { Ref } from 'vue';
import type { JsonValue } from '@app/schemas';
import type { CanvasCardId, CanvasTextCardSchema, CanvasTextDocument } from '@plugin/canvas/shared';
import type { z } from 'zod';

export interface CanvasCardDraft {
  readonly elementId: CanvasCardId;
  readonly content: CanvasTextDocument;
  readonly baseRevision: number;
  readonly editSequence: number;
  readonly savedSequence: number;
  readonly historyGroupId: string;
}
export interface CanvasCardEditingState {
  readonly draft: Readonly<Ref<CanvasCardDraft | null>>;
  readonly saving: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  begin(card: z.infer<typeof CanvasTextCardSchema>, historyGroupId: string): void;
  update(content: CanvasTextDocument): void;
  beginSave(): void;
  saved(baseRevision: number, savedSequence: number): void;
  failed(message: string): void;
  clear(): void;
}
export interface CanvasCardEditor {
  readonly state: CanvasCardEditingState;
  open(elementId: CanvasCardId): Promise<void>;
  update(content: JsonValue): void;
  setComposing(value: boolean): void;
  save(finish?: boolean): Promise<boolean>;
  dispose(): void;
}
