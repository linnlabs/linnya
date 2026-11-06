import type { CanvasCardId, CanvasCommand, CanvasChangedEvent, CanvasCommitResult, CanvasEditingRequestSchema, CanvasEditingClaimSchema, CanvasSnapshot, CanvasSource, CanvasSynchronization, CanvasUndoRequest, CanvasUndoResult } from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { Ref } from 'vue';
import type { CanvasConfirmedMutation } from './canvasMutation';

export type CanvasDocumentPhase = 'closed' | 'loading' | 'ready' | 'failed';
export interface CanvasProjectedCardChange { readonly id: CanvasCardId; readonly sourceKind: CanvasSource['kind'] }
export interface CanvasDocumentProjection { readonly snapshot: CanvasSnapshot; readonly cardChanges: readonly CanvasProjectedCardChange[] }
export interface CanvasDocumentPort {
  read(documentId: string, viewId: string): Promise<CanvasSnapshot>;
  changes(documentId: string, afterSequence: number): Promise<CanvasSynchronization>;
  commit(input: { documentId: string; requestId: string; viewId: string; operations: readonly CanvasCommand[]; historyGroupId?: string }): Promise<CanvasCommitResult>;
  editing(input: z.infer<typeof CanvasEditingRequestSchema>): Promise<void>;
  undo(input: CanvasUndoRequest): Promise<CanvasUndoResult>;
  close(documentId: string, viewId: string): Promise<void>;
  subscribe(callback: (event: CanvasChangedEvent) => void): () => void;
}
export interface CanvasDocumentState {
  readonly projection: Readonly<Ref<CanvasDocumentProjection | null>>;
  readonly snapshot: Readonly<Ref<CanvasSnapshot | null>>;
  readonly phase: Readonly<Ref<CanvasDocumentPhase>>;
  readonly error: Readonly<Ref<string | null>>;
  begin(): void;
  install(snapshot: CanvasSnapshot, cardChanges?: readonly CanvasProjectedCardChange[]): void;
  fail(error: string): void;
  clear(): void;
}
export interface CanvasDocumentSession {
  readonly state: CanvasDocumentState;
  readonly viewId: string;
  readonly deliveryNotice: Readonly<Ref<string | null>>;
  readonly mutationPending: Readonly<Ref<boolean>>;
  open(documentId: string): Promise<void>;
  synchronize(sequence: number): Promise<void>;
  commit(operations: readonly CanvasCommand[], historyGroupId?: string): Promise<CanvasCommitResult>;
  undo(direction: 'undo' | 'redo', options?: { readonly expectedActionId: string }): Promise<CanvasUndoResult>;
  protect(elementId: z.infer<typeof CanvasEditingClaimSchema>['elementId'], fields: z.infer<typeof CanvasEditingClaimSchema>['fields'], owner: string): Promise<void>;
  confirmMutation<T>(operation: CanvasConfirmedMutation<T>): Promise<T>;
  retryDelivery(): Promise<void>;
  close(): Promise<void>;
}
