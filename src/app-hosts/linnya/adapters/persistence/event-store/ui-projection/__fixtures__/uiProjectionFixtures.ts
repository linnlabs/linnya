import {
  createContextUsageSnapshotEvent,
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createFinalAnswerResetEvent,
  createErrorEvent,
  createHistorySummaryEvent,
  createRequiresUserInteractionEvent,
  createRunExecutionMetricsEvent,
  createSubRunTraceEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  createUserInputEvent,
  routeRuntimeEvent,
  type ContextUsageSnapshot,
  type RuntimeEvent,
  type RuntimeResourceRef,
  type SerializableJsonRecord,
  RunIdSchema,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';

export interface UiProjectionFixture {
  readonly name: string;
  readonly events: readonly RuntimeEvent[];
}

interface UnroutedUiProjectionFixture extends UiProjectionFixture {
  readonly runId: string;
}

const conversationId = 'conv_ui_projection_fixture';

export const uiProjectionContextUsage = {
  basis: 'last_completed_llm_prompt',
  budget_model_id: 'primary-model',
  served_model_id: 'fallback-model',
  used_tokens: 1_100,
  components: {
    system_prompt_tokens: 200,
    conversation_tokens: 750,
    tool_definition_tokens: 150,
  },
  component_attribution: 'normalized_local_estimate',
  input_budget_tokens: 1_000,
  remaining_tokens: -100,
  output_limit_tokens: 200,
  source: 'provider-preflight-count',
  confidence: 'provider-estimate',
  measured_at: 129,
} satisfies ContextUsageSnapshot;

const uiProjectionLiveContextUsage = {
  ...uiProjectionContextUsage,
  used_tokens: 900,
  components: {
    system_prompt_tokens: 200,
    conversation_tokens: 600,
    tool_definition_tokens: 100,
  },
  remaining_tokens: 100,
  measured_at: 118,
} satisfies ContextUsageSnapshot;

export const uiProjectionImageAttachments: readonly RuntimeResourceRef[] = [
  {
    id: 'attachment-first',
    kind: 'image',
    resourceId: 'asset-first',
    mediaType: 'image/png',
    byteLength: 128,
    width: 16,
    height: 8,
    sha256: 'a'.repeat(64),
    fileName: 'first.png',
  },
  {
    id: 'attachment-second',
    kind: 'image',
    resourceId: 'asset-second',
    mediaType: 'image/webp',
    byteLength: 256,
    width: 32,
    height: 24,
    sha256: 'b'.repeat(64),
    label: '第二张',
  },
];

function toolCall(id: string, name: string, args: SerializableJsonRecord): SerializableJsonRecord {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function webSearchResult(query: string): SerializableJsonRecord {
  return {
    data: {
      query,
      resultCount: 1,
      citations: {
        query,
        searchMode: 'web',
        citations: [{
          sourceType: 'web',
          ref: 'ABC234',
          index: 1,
          url: 'https://example.com/linnya',
          docTitle: 'Linnya',
          snippet: 'Linnya web result.',
        }],
      },
      evidence_store: { bundle_id: 'fixture-web-search' },
      cacheStatus: 'miss',
    },
    observation: 'Web search result for Linnya.',
  };
}

const unroutedUiProjectionFixtures = [
  {
    name: 'single-turn-with-agent-work',
    runId: 'run_single',
    events: [
      createUserInputEvent(
        'evt_user_single',
        conversationId,
        'turn_single',
        '<user_request>hello</user_request>',
        {
          timestamp: 100,
          raw_content: 'hello',
          attachments: [...uiProjectionImageAttachments],
          metadata: {
            run_id: 'run_single',
            user_quote: {
              items: [
                {
                  quote_id: 'reference-11111111111111111111111111111111',
                  plugin_id: 'platform',
                  kind: 'text-selection',
                  text: 'quoted text',
                  source: { doc_id: 'doc-1' },
                },
              ],
            },
            ui: { presentation: 'message' },
            activity: { runId: 'activity-1', feature: 'projection-parity' },
          },
        }
      ),
      createThoughtEvent('evt_thought_single', conversationId, 'turn_single', 'thinking', {
        timestamp: 110,
        thought_message_id: 'thought_single',
        is_complete: true,
        metadata: { thought_started_at: 105, thought_completed_at: 110 },
      }),
      createContextUsageSnapshotEvent(
        'evt_context_usage_single',
        conversationId,
        'turn_single',
        uiProjectionLiveContextUsage,
        {
          timestamp: 118,
          user_message_id: 'evt_user_single',
        },
      ),
      createFinalAnswerChunkEvent(
        'evt_chunk_single',
        conversationId,
        'turn_single',
        'answer_single',
        0,
        'done',
        {
          timestamp: 119,
          is_last: true,
        }
      ),
      createFinalAnswerEvent('answer_single', conversationId, 'turn_single', 'done', {
        timestamp: 120,
        completion_reason: 'terminal',
      }),
      createRunExecutionMetricsEvent('evt_metrics_single', conversationId, 'turn_single', {
        timestamp: 130,
        execution_id: 'execution_single',
        outcome: 'completed',
        duration_ms: 30,
        user_message_id: 'evt_user_single',
        context_usage: uiProjectionContextUsage,
      }),
    ],
  },
  {
    name: 'consecutive-thought-segments-switch-identity',
    runId: 'run_thought_segments',
    events: [
      createThoughtEvent(
        'evt_thought_segment_a_complete',
        conversationId,
        'turn_thought_segments',
        '第一段思考完成。',
        {
          timestamp: 140,
          thought_message_id: 'thought_segment_a',
          is_complete: true,
          metadata: { thought_started_at: 135, thought_completed_at: 140 },
        },
      ),
      createThoughtEvent(
        'evt_thought_segment_b_delta',
        conversationId,
        'turn_thought_segments',
        '第二段思考开始',
        {
          timestamp: 141,
          thought_message_id: 'thought_segment_b',
          delta: '第二段思考开始',
          is_complete: false,
          metadata: { thought_started_at: 141 },
        },
      ),
      createThoughtEvent(
        'evt_thought_segment_b_complete',
        conversationId,
        'turn_thought_segments',
        '第二段思考完成。',
        {
          timestamp: 145,
          thought_message_id: 'thought_segment_b',
          is_complete: true,
          metadata: { thought_started_at: 141, thought_completed_at: 145 },
        },
      ),
    ],
  },
  {
    name: 'batched-tools-with-secondary-output',
    runId: 'run_tools',
    events: [
      createUserInputEvent('evt_user_tools', conversationId, 'turn_tools', 'run tools', {
        timestamp: 200,
      }),
      createToolCallDecisionEvent(
        'evt_decision_tools',
        conversationId,
        'turn_tools',
        'web_search',
        'call_search',
        {
          timestamp: 210,
          phase: 'start',
          status: 'loading',
          args: { query: 'linnya' },
          payload: {
            args: { query: 'linnya' },
            tool_calls: [
              toolCall('call_search', 'web_search', { query: 'linnya' }),
              toolCall('call_read', 'resource_read', { path: '/tmp/a.md' }),
            ],
          },
        }
      ),
      createToolProcessEvent(
        'evt_process_search',
        conversationId,
        'turn_tools',
        'web_search',
        'call_search',
        {
          timestamp: 215,
          phase: 'update',
          status: 'loading',
          payload: { progress: 0.5 },
        }
      ),
      createToolOutputEvent(
        'evt_output_read',
        conversationId,
        'turn_tools',
        'resource_read',
        'call_read',
        { status: 'success', observation: 'file content', data: 'file content' },
        {
          timestamp: 220,
          attachments: [uiProjectionImageAttachments[1]!],
        }
      ),
    ],
  },
  {
    name: 'subrun-summary-attaches-to-parent-tool',
    runId: 'run_subrun',
    events: [
      createToolCallDecisionEvent(
        'evt_decision_subrun',
        conversationId,
        'turn_subrun',
        'deep_search',
        'call_deep',
        {
          timestamp: 300,
          payload: { args: { query: 'agent architecture' } },
        }
      ),
      createSubRunTraceEvent(
        'evt_subrun_1',
        conversationId,
        'turn_subrun',
        'call_deep',
        'subrun_a',
        'thought_delta',
        {
          source_event_id: 'child_thought_1',
          timestamp: 310,
          delta: 'searching',
        }
      ),
      createSubRunTraceEvent(
        'evt_subrun_2',
        conversationId,
        'turn_subrun',
        'call_deep',
        'subrun_a',
        'tool_output',
        {
          source_event_id: 'child_output_1',
          timestamp: 320,
          tool_name: 'web_search',
          tool_call_id: ToolCallIdSchema.parse('child_web_search_1'),
          status: 'success',
          output: webSearchResult('agent architecture'),
        }
      ),
      createToolOutputEvent(
        'evt_subrun_output',
        conversationId,
        'turn_subrun',
        'deep_search',
        'call_deep',
        {
          status: 'success',
          observation: 'batch done',
          data: { subrun_ids: ['subrun_b', 'subrun_a', 'subrun_c'] },
        },
        {
          timestamp: 330,
        }
      ),
    ],
  },
  {
    name: 'summary-chain',
    runId: 'run_summary',
    events: [
      createUserInputEvent('evt_user_old', conversationId, 'turn_summary', 'old question', {
        timestamp: 400,
      }),
      createFinalAnswerChunkEvent(
        'evt_chunk_old',
        conversationId,
        'turn_summary',
        'answer_old',
        0,
        'old answer',
        {
          timestamp: 409,
          is_last: true,
        }
      ),
      createFinalAnswerEvent('answer_old', conversationId, 'turn_summary', 'old answer', {
        timestamp: 410,
        completion_reason: 'terminal',
      }),
      createHistorySummaryEvent(
        'evt_summary_regular',
        conversationId,
        'turn_summary',
        'compressed old discussion',
        ['evt_user_old', 'answer_old'],
        2,
        1,
        {
          timestamp: 420,
          compression_ratio: 0.4,
        }
      ),
      createHistorySummaryEvent(
        'evt_summary_latest',
        conversationId,
        'turn_summary',
        'latest compressed summary',
        ['evt_summary_regular'],
        3,
        2,
        {
          timestamp: 430,
          compression_ratio: 0.3,
        }
      ),
    ],
  },
  {
    name: 'research-writer-final-answer',
    runId: 'run_writer',
    events: [
      createToolCallDecisionEvent(
        'evt_decision_writer',
        conversationId,
        'turn_writer',
        'research_run_writer',
        'call_writer',
        {
          timestamp: 500,
          payload: { args: { description: 'write report', prompt: 'write read model report' } },
        }
      ),
      createToolOutputEvent(
        'evt_output_writer',
        conversationId,
        'turn_writer',
        'research_run_writer',
        'call_writer',
        {
          status: 'success',
          observation: 'writer done',
          data: {
            description: 'write report',
            prompt_key: 'deep_research_writer',
            subrun_ids: ['subrun_writer'],
            inherit_turns: 1,
            max_steps: 60,
            success: true,
            final_answer: 'final report',
            uris: [],
            doc_uris_by_name: {},
            evidence_snapshot_generated: false,
            evidence_snapshot_uri_count: 0,
          },
        },
        {
          timestamp: 510,
        }
      ),
      createFinalAnswerChunkEvent(
        'evt_chunk_writer',
        conversationId,
        'turn_writer',
        'answer_call_writer',
        0,
        'final report',
        {
          timestamp: 511,
          is_last: true,
        }
      ),
      createFinalAnswerEvent('answer_call_writer', conversationId, 'turn_writer', 'final report', {
        timestamp: 512,
        completion_reason: 'terminal',
      }),
    ],
  },
  {
    name: 'interrupted-turn-with-skipped-chunk',
    runId: 'run_interrupted',
    events: [
      createUserInputEvent(
        'evt_user_interrupted',
        conversationId,
        'turn_interrupted',
        'start long task',
        {
          timestamp: 600,
        }
      ),
      createFinalAnswerChunkEvent(
        'evt_chunk_interrupted',
        conversationId,
        'turn_interrupted',
        'answer_interrupted',
        0,
        'partial',
        {
          timestamp: 610,
        }
      ),
      createFinalAnswerEvent('answer_interrupted', conversationId, 'turn_interrupted', 'partial', {
        timestamp: 620,
        completion_reason: 'interrupted',
      }),
      createRunExecutionMetricsEvent(
        'evt_metrics_interrupted',
        conversationId,
        'turn_interrupted',
        {
          timestamp: 640,
          execution_id: 'execution_interrupted',
          outcome: 'cancelled',
          duration_ms: 40,
          user_message_id: 'evt_user_interrupted',
        }
      ),
    ],
  },
  {
    name: 'failed-answer-reset-before-retry',
    runId: 'run_answer_reset',
    events: [
      createFinalAnswerChunkEvent(
        'evt_chunk_failed_reset',
        conversationId,
        'turn_answer_reset',
        'answer_failed_reset',
        0,
        'discarded attempt',
        { timestamp: 650 }
      ),
      createFinalAnswerResetEvent('evt_answer_reset', conversationId, 'turn_answer_reset', {
        timestamp: 651,
        answer_id: 'answer_failed_reset',
      }),
      createFinalAnswerChunkEvent(
        'evt_chunk_after_reset',
        conversationId,
        'turn_answer_reset',
        'answer_after_reset',
        0,
        'successful retry',
        { timestamp: 652, is_last: true }
      ),
      createFinalAnswerEvent(
        'answer_after_reset',
        conversationId,
        'turn_answer_reset',
        'successful retry',
        { timestamp: 653, completion_reason: 'terminal' }
      ),
    ],
  },
  {
    name: 'interactive-tool-wait-and-run-error',
    runId: 'run_interactive_error',
    events: [
      createToolCallDecisionEvent(
        'evt_decision_interactive',
        conversationId,
        'turn_interactive_error',
        'ask',
        'call_interactive',
        {
          timestamp: 700,
        }
      ),
      createRequiresUserInteractionEvent(
        'evt_wait_interactive',
        conversationId,
        'turn_interactive_error',
        {
          timestamp: 710,
          interaction_id: 'interaction_interactive',
          run_id: RunIdSchema.parse('run_interactive_error'),
          tool_call_id: ToolCallIdSchema.parse('call_interactive'),
          checkpoint_revision: 1,
          resume_token: 'resume_interactive',
          interaction_status: 'pending',
          form: {
            data: {
              questionnaireId: 'questionnaire_interactive',
              allowSkip: true,
              submitLabel: '提交',
              skipLabel: '跳过',
              questions: [
                {
                  id: 'question_interactive',
                  type: 'text',
                  question: '请补充需求',
                  options: [],
                  allowOther: false,
                  required: true,
                },
              ],
            },
            observation: '等待用户回答',
          },
        }
      ),
      createErrorEvent(
        'evt_error_interactive',
        conversationId,
        'turn_interactive_error',
        'provider request failed',
        {
          timestamp: 720,
          error_code: 'llm.request_failed',
          retryable: true,
        }
      ),
    ],
  },
] satisfies readonly UnroutedUiProjectionFixture[];

export const uiProjectionFixtures: readonly UiProjectionFixture[] =
  unroutedUiProjectionFixtures.map(({ runId, ...fixture }) => ({
    ...fixture,
    events: fixture.events.map(event =>
      routeRuntimeEvent(event, {
        run_id: runId,
        lane: 'foreground',
        visibility: 'conversation',
      })
    ),
  }));
