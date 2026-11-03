import type { CanvasCommand, CanvasCommitResult, CanvasEditingRequestSchema, CanvasSnapshot, CanvasSynchronization, CanvasUndoRequest, CanvasUndoResult } from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { Ref } from 'vue';

export type CanvasDocumentPhase = 'closed' | 'loading' | 'ready' | 'failed';
export interface CanvasDocumentPort {
  read(documentId: string, viewId: string): Promise<CanvasSnapshot>;
  changes(documentId: string, afterSequence: number): Promise<CanvasSynchronization>;
  commit(input: { documentId: string; requestId: string; viewId: string; operations: readonly CanvasCommand[]; historyGroupId?: string }): Promise<CanvasCommitResult>;
  editing(input: z.infer<typeof CanvasEditingRequestSchema>): Promise<void>;
  undo(input: CanvasUndoRequest): Promise<CanvasUndoResult>;
  close(documentId: string, viewId: string): Promise<void>;
  subscribe(callback: (event: { documentId: string; sequence: number }) => void): () => void;
}
export interface CanvasDocumentState {
  readonly snapshot: Readonly<Ref<CanvasSnapshot | null>>;
  readonly phase: Readonly<Ref<CanvasDocumentPhase>>;
  readonly error: Readonly<Ref<string | null>>;
  begin(): void;
  install(snapshot: CanvasSnapshot): void;
  fail(error: string): void;
  clear(): void;
}
export interface CanvasDocumentSession {
  readonly state: CanvasDocumentState;
  readonly viewId: string;
  open(documentId: string): Promise<void>;
  synchronize(sequence: number): Promise<void>;
  commit(operations: readonly CanvasCommand[], historyGroupId?: string): Promise<CanvasCommitResult>;
  undo(direction: 'undo' | 'redo'): Promise<CanvasUndoResult>;
  protect(elementId: z.infer<typeof CanvasEditingRequestSchema>['elementId'], fields: z.infer<typeof CanvasEditingRequestSchema>['fields']): Promise<void>;
  close(): Promise<void>;
}
