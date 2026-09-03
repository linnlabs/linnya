import type { SubRunTraceEvent } from '@linnlabs/linnkit/contracts';

export const DURABLE_SUBRUN_TRACE_KINDS = [
  'thought_complete',
  'tool_call_decision',
  'tool_output',
  'final_answer',
  'history_summary',
] as const satisfies readonly SubRunTraceEvent['kind'][];

export type DurableSubrunTraceKind = (typeof DURABLE_SUBRUN_TRACE_KINDS)[number];

export type DurableSubrunTraceEvent = SubRunTraceEvent & {
  readonly kind: DurableSubrunTraceKind;
};

export interface SubrunTraceHistoryProjectorPort {
  project(event: SubRunTraceEvent): void;
}
