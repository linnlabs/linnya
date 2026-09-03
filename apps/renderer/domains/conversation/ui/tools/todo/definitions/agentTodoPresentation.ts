import type { AgentTodoToolData, AgentTodoToolItem } from '@app/schemas';

export type AgentTodoPresentationOperation = 'read' | 'write';

export interface AgentTodoPresentationCounts {
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly total: number;
}

export type AgentTodoPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly operation: AgentTodoPresentationOperation;
    }
  | {
      readonly kind: 'snapshot';
      readonly operation: AgentTodoPresentationOperation;
      readonly todo: AgentTodoToolData;
      readonly items: readonly AgentTodoToolItem[];
      readonly counts: AgentTodoPresentationCounts;
      readonly progressPercent: number;
    };
