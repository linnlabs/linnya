import { describe, expect, it } from 'vitest';
import {
  ConversationControlCommandRequestSchema,
  ConversationControlConnectionDescriptorSchema,
  ConversationControlMessagesRequestSchema,
  ConversationControlModelsResponseSchema,
  ConversationControlAuditResponseSchema,
  ConversationControlProgressFrameSchema,
  ConversationControlRunStatusSnapshotSchema,
  ConversationControlWorkspaceToolsResponseSchema,
} from './index';

describe('conversation-control wire contract', () => {
  it('models 只返回可复制的选择身份和安全能力，不接纳内部 route', () => {
    const response = ConversationControlModelsResponseSchema.parse({
      schema_version: 1,
      ok: true,
      command: 'models',
      chat: [
        {
          model_config_id: 'model-config-1',
          model_name: 'gpt-5.6-sol',
          display_name: 'GPT-5.6 Sol',
          catalog_source: 'account',
          available: true,
          input_support: { user_image: true, tool_result_image: true },
          reasoning: { supported_efforts: ['low', 'medium', 'high'] },
        },
      ],
      image_generation: [
        {
          model_config_id: 'image-model-1',
          model_name: 'gpt-image-2',
          display_name: 'GPT Image 2',
          catalog_source: 'account',
          available: false,
          unavailable_reason: 'credential_missing',
        },
      ],
    });
    expect(response.chat[0]?.model_config_id).toBe('model-config-1');
    expect(
      ConversationControlModelsResponseSchema.safeParse({
        ...response,
        chat: [
          {
            ...response.chat[0],
            inference_route: { base_url: 'must-not-cross-cli-wire' },
          },
        ],
      }).success
    ).toBe(false);
  });

  it('只接纳窄 send 产品参数，拒绝内部执行开关', () => {
    expect(
      ConversationControlCommandRequestSchema.parse({
        schema_version: 1,
        command: 'send',
        message: '生成一份三页的产品介绍 PPT',
        selected_agent_id: 'plugin_agent_fixture',
        image_generation_model_id: 'chatgpt-subscription-gpt-image-2',
        reasoning_effort: 'medium',
      })
    ).toMatchObject({
      command: 'send',
      selected_agent_id: 'plugin_agent_fixture',
      image_generation_model_id: 'chatgpt-subscription-gpt-image-2',
    });

    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'send',
        message: 'hello',
        promptKey: 'default',
        persist: false,
      }).success
    ).toBe(false);

    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'send',
        message: 'hello',
        imageGenerationModelId: 'internal-field-must-not-cross-wire',
      }).success
    ).toBe(false);
  });

  it('workspace_tools 只允许五个基础工具，call 必须声明项目作用域', () => {
    expect(
      ConversationControlCommandRequestSchema.parse({
        schema_version: 1,
        command: 'workspace_tools',
        action: 'call',
        tool_name: 'edit_file',
        args: {
          locator: 'workspace:/notes.md',
          old_text: 'before',
          new_text: 'after',
        },
        conversation_id: 'conversation-1',
      })
    ).toMatchObject({
      command: 'workspace_tools',
      action: 'call',
      tool_name: 'edit_file',
    });

    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'workspace_tools',
        action: 'call',
        tool_name: 'shell',
        args: {},
        project_id: 'project-1',
      }).success
    ).toBe(false);

    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'workspace_tools',
        action: 'call',
        tool_name: 'read_file',
        args: { locator: 'workspace:/notes.md' },
      }).success
    ).toBe(false);
  });

  it('workspace_tools list 保持轻量，只有 describe 返回完整参数合同', () => {
    const summary = {
      name: 'read_file',
      description: 'Read one Workspace file',
    } as const;
    expect(
      ConversationControlWorkspaceToolsResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'workspace_tools',
        action: 'list',
        tools: [summary],
      })
    ).toMatchObject({ tools: [summary] });

    expect(
      ConversationControlWorkspaceToolsResponseSchema.safeParse({
        schema_version: 1,
        ok: true,
        command: 'workspace_tools',
        action: 'list',
        tools: [{ ...summary, parameters: { type: 'object' } }],
      }).success
    ).toBe(false);

    expect(
      ConversationControlWorkspaceToolsResponseSchema.parse({
        schema_version: 1,
        ok: true,
        command: 'workspace_tools',
        action: 'describe',
        tool: { ...summary, parameters: { type: 'object' } },
      })
    ).toMatchObject({
      tool: { ...summary, parameters: { type: 'object' } },
    });
  });

  it('respond 只暴露 expected interaction 与用户响应，不接纳 resume token', () => {
    expect(
      ConversationControlCommandRequestSchema.parse({
        schema_version: 1,
        command: 'respond',
        conversation_id: 'conversation-1',
        expected_interaction_id: 'interaction-1',
        response: { kind: 'approve' },
      })
    ).toMatchObject({ command: 'respond', response: { kind: 'approve' } });

    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'respond',
        conversation_id: 'conversation-1',
        expected_interaction_id: 'interaction-1',
        resume_token: 'must-not-cross-cli-wire',
        response: { kind: 'approve' },
      }).success
    ).toBe(false);
  });

  it('resume 必须精确钉住 settled pause 身份，不能携带新消息或审批', () => {
    expect(
      ConversationControlCommandRequestSchema.parse({
        schema_version: 1,
        command: 'resume',
        conversation_id: 'conversation-1',
        expected_run_id: 'run-1',
        expected_execution_id: 'execution-1',
        expected_updated_at: 110,
      })
    ).toMatchObject({ command: 'resume', expected_run_id: 'run-1' });
    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'resume',
        conversation_id: 'conversation-1',
        expected_run_id: 'run-1',
        expected_execution_id: 'execution-1',
        expected_updated_at: 110,
        message: '继续',
      }).success
    ).toBe(false);
    expect(
      ConversationControlCommandRequestSchema.safeParse({
        schema_version: 1,
        command: 'resume',
        conversation_id: 'conversation-1',
        expected_run_id: 'run-1',
      }).success
    ).toBe(false);
  });

  it('连接描述只允许 loopback 和固定长度 session token', () => {
    const base = {
      protocol_version: 2,
      app_instance_id: 'app-1',
      pid: 123,
      host: '127.0.0.1',
      port: 43123,
      session_token: 'a'.repeat(64),
      created_at: 100,
      updated_at: 100,
    };
    expect(ConversationControlConnectionDescriptorSchema.parse(base).host).toBe('127.0.0.1');
    expect(
      ConversationControlConnectionDescriptorSchema.safeParse({
        ...base,
        host: '0.0.0.0',
      }).success
    ).toBe(false);
  });

  it('status/watch 区分 paused 与审批，但不包含虚构百分比', () => {
    const snapshot = ConversationControlRunStatusSnapshotSchema.parse({
      conversation_id: 'conversation-1',
      run_id: 'run-1',
      turn_id: 'turn-1',
      execution_id: 'execution-1',
      agent_id: 'plugin_agent_fixture',
      status: 'awaiting_user',
      started_at: 100,
      updated_at: 200,
      pending_interaction: {
        interaction_id: 'interaction-1',
        tool_name: 'ppt_plan',
        form: { title: '计划' },
      },
      result_available: false,
    });
    expect(
      ConversationControlProgressFrameSchema.parse({
        schema_version: 1,
        frame: 'status',
        sequence: 0,
        observed_at: 210,
        snapshot,
      }).snapshot?.status
    ).toBe('awaiting_user');
    expect(
      ConversationControlRunStatusSnapshotSchema.safeParse({
        ...snapshot,
        status: 'paused',
      }).success
    ).toBe(true);
    expect(
      ConversationControlRunStatusSnapshotSchema.safeParse({
        ...snapshot,
        percent: 50,
      }).success
    ).toBe(false);
  });

  it('messages 分页合同保持会话级，不接受会破坏游标语义的 run_id', () => {
    expect(
      ConversationControlMessagesRequestSchema.safeParse({
        schema_version: 1,
        command: 'messages',
        conversation_id: 'conversation-1',
        limit: 80,
        window: 'tail',
        run_id: 'run-1',
      }).success
    ).toBe(false);
  });

  it('audit 只接受安全聚合，并明确 telemetry 不是完整事实源', () => {
    const response = ConversationControlAuditResponseSchema.parse({
      schema_version: 1,
      ok: true,
      command: 'audit',
      conversation_id: 'conversation-1',
      generated_at: 300,
      completeness: {
        run_registry: 'complete',
        event_store: 'complete',
        telemetry: 'best_effort',
        telemetry_retention_days: 7,
      },
      source_window: {
        telemetry_events: 1,
        event_facts: 3,
        earliest_telemetry_at: 100,
        latest_telemetry_at: 100,
      },
      runs: [
        {
          run_id: 'run-1',
          agent_id: 'plugin_agent_fixture',
          status: 'completed',
          started_at: 90,
          updated_at: 200,
        },
      ],
      llm: {
        calls: 1,
        duration_ms: 80,
        provider_actual_calls: 1,
        estimate_calls: 0,
        missing_usage_calls: 0,
        actual_tokens: { input_tokens: 100, output_tokens: 10 },
        by_model: [],
      },
      tools: { calls: 0, failed_calls: 0, duration_ms: 0, by_tool: [] },
      workspace_documents: { observations: 0, observations_with_errors: 0,
        observations_with_warnings: 0, visible: { error: 0, warning: 0, info: 0 },
        truncated_count: 0, by_observation: [] },
      tool_pairing: {
        complete: true,
        paired: 1,
        decision_missing: 0,
        terminal_missing: 0,
        duplicate_terminal: 0,
        name_mismatches: 0,
        records: [
          {
            run_id: 'run-1',
            tool_call_id: 'call-1',
            tool_name: 'read_file',
            pairing_status: 'paired',
            decision_count: 1,
            terminal_count: 1,
            terminal_status: 'success',
            name_consistent: true,
          },
        ],
      },
      commands: {
        executions: 0,
        terminal_observations: 0,
        nonzero_exit_executions: 0,
        runtime_failure_executions: 0,
        by_execution: [],
      },
      context_compaction: {
        observations: 0,
        attempts: 0,
        completed: 0,
        failed: 0,
        insufficient: 0,
        aborted: 0,
        skipped: 0,
        duration_ms: 0,
        provider_actual_calls: 0,
        estimate_calls: 0,
        missing_usage_calls: 0,
        actual_tokens: { input_tokens: 0, output_tokens: 0 },
        by_run: [],
      },
      run_lifecycle: { by_run: [] },
    });
    expect(response.completeness.telemetry).toBe('best_effort');
    expect(
      ConversationControlAuditResponseSchema.safeParse({
        ...response,
        prompt: 'must never cross this wire',
      }).success
    ).toBe(false);
  });
});
