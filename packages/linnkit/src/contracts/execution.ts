import { z } from 'zod';
import { ExecutionIdSchema, TraceIdSchema } from './identity';

export const ExecutionTraceContext = z.object({
  /** execution_id 的命名空间由 identity contract 统一定义；这里仅补充 trace 语境。 */
  execution_id: ExecutionIdSchema.describe('The unique identifier for a single, complete execution flow.'),
  trace_id: TraceIdSchema.optional().describe('An optional trace ID for correlating logs in an APM system.'),
});

const EventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative().describe('A monotonically increasing sequence number within a single execution.'),
  timestamp: z.number().describe('The high-precision timestamp of when the event occurred.'),
  trace: ExecutionTraceContext,
  source: z.string().describe("The origin of the event, e.g., 'ai', 'tool:file_reader', 'system:summary'."),
  payload: z.unknown(),
  render_hint: z.object({
    card: z.enum(['normal', 'collapsible', 'none', 'image', 'interactive']).optional().describe('Hint for how the UI card should be rendered.'),
    content: z.enum(['markdown', 'text', 'json', 'image_url', 'code']).default('text').describe('Hint for how the content itself should be interpreted.'),
  }).optional(),
  run_location: z.enum(['frontend', 'backend']).optional().describe('Specifies where a tool action should be or was executed.'),
});

export const EventEnvelope = EventEnvelopeSchema;

type EventEnvelopeBase = z.infer<typeof EventEnvelopeSchema>;

export type EventEnvelope<TPayload = unknown> = Omit<EventEnvelopeBase, 'payload'> & {
  payload: TPayload;
};

export type ExecutionTraceContext = z.infer<typeof ExecutionTraceContext>;
