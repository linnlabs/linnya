export const TELEMETRY_EVENT_KINDS = [
  'llm_call',
  'tool_call',
  'context_build',
  'context_compaction',
  'graph_node',
  'run_lifecycle',
] as const;

export type TelemetryEventKind = (typeof TELEMETRY_EVENT_KINDS)[number];
