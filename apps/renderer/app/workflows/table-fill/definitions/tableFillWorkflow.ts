import type { SubrunBatchArgs } from '@app/schemas';
import type {
  TableFillInputReference,
  BuildTableFillRowPlansInput,
  TableFillRowPlan,
  TableFillWritePort,
  TableFillWriteSessionOwner,
  TableFillWriteUnitTarget,
} from '@/domains/editor/features/table-fill-write';
import type { TableCellWriteEditor } from '@/domains/editor/blocks/TableBlock/ai/tableCellWriter.js';
import type { InvokeAssistantParams } from '@/domains/conversation/services/assistantService';
import type { AssistantServiceCallbacks } from '@/domains/conversation/types';
import type { ConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import type { PrepareTableFillRunResult, PreparedTableFillRun } from './tableFillRunCommand';

export interface TableFillWorkflowInput {
  prompt: string;
  editor: TableCellWriteEditor;
  table: {
    initialPos: number;
    rootBlockId: string;
  };
  outputRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  activeInputRefs: readonly TableFillInputReference[];
  imageGenerationModelId?: string;
}

export interface TableFillBatchPlan {
  args: SubrunBatchArgs;
  writeTargets: readonly TableFillWriteUnitTarget[];
  unitIds: ReadonlySet<string>;
  unitIdBySubrunId: ReadonlyMap<string, string>;
}

export interface TableFillExecutionStatePort {
  begin(controller: AbortController): void;
  settle(params: {
    controller: AbortController;
    completedSuccessfully: boolean;
    errorMessage: string | null;
  }): void;
}

export interface ExecuteTableFillRunDependencies {
  executionState: TableFillExecutionStatePort;
  readActiveConversationId(): string | null;
  ensureHistoryTail(conversationId: string): Promise<unknown>;
  prepareRunCommand(params: {
    signal: AbortSignal;
  }): Promise<PrepareTableFillRunResult>;
  createUserInputAdmission(input: {
    readonly run: PreparedTableFillRun;
    readonly prompt: string;
  }): ConversationUserInputAdmission;
  buildRowPlans(input: BuildTableFillRowPlansInput): {
    table: TableFillWorkflowInput['table'];
    rows: readonly TableFillRowPlan[];
  };
  buildBatchPlan(rows: readonly TableFillRowPlan[]): TableFillBatchPlan;
  createSessionId(): string;
  writePort: TableFillWritePort;
  writeSessions: TableFillWriteSessionOwner;
  requestSave(): Promise<void>;
  invokeAssistant(
    params: InvokeAssistantParams,
    callbacks: AssistantServiceCallbacks,
    signal: AbortSignal,
  ): Promise<void>;
  resolveProcessingFailureMessage(): string;
}

export interface TableFillWorkflow {
  submit(prompt: string): Promise<void>;
  cancel(): void;
  deactivate(): Promise<void>;
}
