export type TableAiModePhase = 'off' | 'active' | 'closing';

export interface TableAiModeRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly isOutputColumn?: boolean;
  readonly needsNewColumn?: boolean;
}

export interface TableAiModeColumnReference {
  readonly name: string;
  readonly reference: string;
  readonly range: string;
  readonly rect?: TableAiModeRect;
}

export interface TableAiComposerColumnReferenceToken {
  readonly refKey: string;
  readonly label: string;
  readonly color: string;
}

/** Table UI 操作 composer 所需的最窄能力；具体输入编辑器实现归宿主持有。 */
export interface TableAiComposerPort {
  insertColumnReference(token: TableAiComposerColumnReferenceToken): boolean;
}

export interface TableAiModeActiveColumnReference {
  readonly id: string;
  readonly color: string;
  readonly rect: TableAiModeRect;
  readonly active: boolean;
}

export interface TableAiModeTableIdentity {
  readonly editorId: string;
  readonly rootBlockId: string | null;
  readonly lastKnownPos: number;
}

export interface TableAiModeContext {
  readonly columnRefs: readonly TableAiModeColumnReference[];
  readonly selectionRange: string;
  readonly outputColumnRange: string;
  readonly activeColumnRefs: Readonly<Record<string, TableAiModeActiveColumnReference>>;
  readonly outputRect: TableAiModeRect | null;
  readonly outputColumnAdded: boolean;
  readonly insertedColumnIndex?: number;
}

export interface TableAiModeExecutionState {
  readonly isLoading: boolean;
  readonly isStreaming: boolean;
  readonly error: string | null;
  readonly controller: AbortController | null;
  readonly completedSuccessfully: boolean;
}

export interface TableAiModeSession {
  readonly sessionId: string;
  readonly table: TableAiModeTableIdentity;
  readonly context: TableAiModeContext;
  readonly execution: TableAiModeExecutionState;
}

export interface StartTableAiModeSessionInput {
  readonly sessionId: string;
  readonly table: TableAiModeTableIdentity;
  readonly context: TableAiModeContext;
}

export interface SettleTableAiModeExecutionInput {
  readonly controller: AbortController;
  readonly completedSuccessfully: boolean;
  readonly errorMessage: string | null;
}

export interface TableAiColumnReferenceHighlightRequest {
  readonly sessionId: string;
  readonly activeColumnRefs: Readonly<Record<string, TableAiModeActiveColumnReference>>;
}
