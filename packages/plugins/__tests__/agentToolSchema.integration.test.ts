import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import {
  createAiSdkInferenceCapability,
  createAiSdkLanguageModelRegistry,
  type AiSdkInferenceRoute,
} from '@linnlabs/linnkit-provider-ai-sdk';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { slidesBackendPlugin } from '@plugin/slides/backend';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { ToolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';

const TOOL_NAMES = [
  'list_files',
  'read_file',
  'grep',
  'edit_file',
  'write_file',
  'process',
  'ppt_inspect',
];
const route: AiSdkInferenceRoute = {
  model_id: 'workspace-codec-fixture',
  request_profile: 'anthropic_messages',
  capability_id: 'ai-sdk:anthropic-messages',
  endpoint_id: 'fixture-anthropic-compatible',
  endpoint_model_id: 'claude-fixture',
  surface: 'anthropic_messages',
  base_url: 'https://fixture.invalid/v1',
};
const WireRequestSchema = z.object({
  tools: z.array(z.object({ name: z.string(), input_schema: z.record(z.string(), z.unknown()) })),
  tool_choice: z.object({ type: z.string() }),
});

function successfulMessageStream(): Response {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'fixture-message',
        model: route.endpoint_model_id,
        role: 'assistant',
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

beforeEach(() => {
  ensureBuiltinBackendPluginsRegistered();
  if (!backendPluginRegistry.has(slidesBackendPlugin.meta.id)) {
    backendPluginRegistry.register({ ...slidesBackendPlugin, pluginCli: undefined });
  }
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', slidesBackendPlugin.meta.id] });
});
afterEach(() => clearPluginRuntimeStateForTests());

describe('Core / Slides 工具目录 → Anthropic 真实 codec', () => {
  it.each(['auto', 'none'] as const)(
    '聊天/压缩 tool_choice=%s 都能携带真实工具目录完成请求',
    async toolChoice => {
      const registry = new ToolRegistry({ strictInitialization: true });
      const tools = registry
        .getToolSchemas({
          toolNames: TOOL_NAMES,
          invocation: { query: 'hi', promptKey: 'default' },
        })
        .map(schema => schema.function);
      expect(tools.map(tool => tool.name)).toEqual(TOOL_NAMES);
      const rejectedTools: string[] = [];
      let fetchCount = 0;
      const providerFetch: typeof fetch = async (_input, init) => {
        fetchCount += 1;
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
        const body = WireRequestSchema.parse(JSON.parse(init.body));
        expect(body.tool_choice.type).toBe(toolChoice);
        expect(body.tools.map(tool => tool.input_schema)).toEqual(
          tools.map(tool => tool.parameters)
        );
        // 复现上游实际的请求准入规则；嵌套 action 分支仍合法，不能递归删掉所有组合约束。
        rejectedTools.push(
          ...body.tools
            .filter(tool =>
              ['oneOf', 'anyOf', 'allOf'].some(keyword => keyword in tool.input_schema)
            )
            .map(tool => tool.name)
        );
        if (rejectedTools.length > 0) {
          return Response.json(
            {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'input_schema does not support oneOf, allOf, or anyOf at the top level',
              },
            },
            { status: 400 }
          );
        }
        return successfulMessageStream();
      };
      const capability = createAiSdkInferenceCapability(route.capability_id, route.surface, {
        language_models: createAiSdkLanguageModelRegistry(providerFetch),
      });
      const request: CanonicalInferenceRequest = {
        model_id: route.model_id,
        messages: [
          { role: 'system', content: 'Workspace assistant' },
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          ...(toolChoice === 'none'
            ? [
                {
                  role: 'user' as const,
                  content: [{ type: 'text' as const, text: 'Summarize history' }],
                },
              ]
            : []),
        ],
        tools,
        tool_choice: toolChoice,
        cache_policy: { breakpoints: [{ anchor: 'end_of_system_prompt', message_index: 0 }] },
        sampling: { max_output_tokens: 64 },
        invocation: { trace_id: 'fixture-trace', attempt_id: 'fixture-attempt' },
      };
      const events: CanonicalInferenceEvent[] = [];
      for await (const event of capability.stream({
        request,
        route,
        credential: { profile: 'api_key', secret: 'fixture-secret' },
      }))
        events.push(event);

      expect(rejectedTools).toEqual([]);
      expect(fetchCount).toBe(1);
      expect(events).toContainEqual({ type: 'answer_delta', text: 'hello' });
      expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'stop' });
    }
  );
});
