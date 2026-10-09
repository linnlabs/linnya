import {
  createToolCallDecisionEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  type ObservationTruncationMeta,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { WorkspaceReadFileEventResultSchema } from '@app/schemas';
import type { UiProjectionFixture } from './uiProjectionFixtures';

const originalObservation = `1: ${'😀'.repeat(20_000)}\n2: 第二行`;
const previewObservation = originalObservation.slice(0, 19_999);

export const toolObservationTruncation = {
  blobId: '0123456789abcdef',
  originalChars: originalObservation.length,
  previewChars: previewObservation.length,
  originalLines: 2,
  previewLines: 1,
} satisfies ObservationTruncationMeta;

const readResult = WorkspaceReadFileEventResultSchema.parse({
  data: {
    source_kind: 'conversation_file',
    locator: 'conversation:/source.md',
    file_name: 'source.md',
    content_type: 'text/markdown',
    byte_length: 80_010,
    offset: 1,
    limit: 2,
    line_count: 2,
    total_line_count: 2,
    has_more: false,
  },
  observation: originalObservation,
});

const conversationId = 'conv_ui_projection_fixture';
const runId = 'run_observation_truncation';
const turnId = 'turn_observation_truncation';
const args = { locator: readResult.data.locator, offset: 1, limit: 2 };

const events: RuntimeEvent[] = [
  createToolCallDecisionEvent(
    'decision_truncated', conversationId, turnId, 'read_file', 'call_truncated',
    { timestamp: 800, phase: 'start', status: 'loading', args },
  ),
  createToolOutputEvent(
    'output_truncated', conversationId, turnId, 'read_file', 'call_truncated',
    { status: 'success', data: readResult.data, observation: previewObservation },
    { timestamp: 801, metadata: { observationTruncation: toolObservationTruncation } },
  ),
  // 旧事实允许保留已知字符计量而没有 blob 身份，不能删除整份截断事实。
  createToolOutputEvent(
    'output_historical_truncated', conversationId, turnId, 'read_file', 'call_historical_truncated',
    { status: 'success', data: readResult.data, observation: previewObservation },
    {
      timestamp: 802,
      metadata: {
        observationTruncation: {
          originalChars: originalObservation.length,
          previewChars: previewObservation.length,
        },
      },
    },
  ),
  // 用户源文可以逐字包含所有治理标记；没有 metadata 时不能据此创建截断事实。
  createToolOutputEvent(
    'output_source_markers', conversationId, turnId, 'read_file', 'call_source_markers',
    {
      status: 'success',
      data: readResult.data,
      observation: '1: tool_output://source-example blob_id=source-example\n2: [output truncated]',
    },
    { timestamp: 803 },
  ),
];

export const toolObservationTruncationFixture: UiProjectionFixture = {
  name: 'tool-observation-truncation-facts',
  events: events.map(event => routeRuntimeEvent(event, {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  })),
};
