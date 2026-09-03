export interface TemplateFile {
  path: string;
  content: string;
}

const AI_SDK_ADAPTER = `import { APICallError, createProviderRegistry, jsonSchema, stepCountIs, streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

function projectMessages(messages) {
  const toolNames = new Map();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.name);
  }
  return messages.map(message => {
    if (message.role === 'system') return message;
    if (message.role === 'user') {
      return {
        role: 'user',
        content: message.content.map(block => {
          if (block.type !== 'text') {
            throw new Error('The minimal quickstart adapter does not enable image input.');
          }
          return { type: 'text', text: block.text };
        }),
      };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: [
          ...message.content.map(block => ({ type: 'text', text: block.text })),
          ...(message.tool_calls ?? []).map(call => ({
            type: 'tool-call',
            toolCallId: call.id,
            toolName: call.name,
            input: call.arguments,
          })),
        ],
      };
    }
    const toolName = toolNames.get(message.tool_call_id);
    if (!toolName) throw new Error('Tool result has no matching assistant tool call.');
    const text = message.content.map(block => {
      if (block.type !== 'text') {
        throw new Error('The minimal quickstart adapter does not enable tool-result images.');
      }
      return block.text;
    }).join('');
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: message.tool_call_id,
        toolName,
        output: { type: 'text', value: text },
      }],
    };
  });
}

function projectTools(definitions) {
  return Object.fromEntries(definitions.map(definition => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.parameters),
    }),
  ]));
}

function projectToolChoice(choice) {
  return typeof choice === 'object'
    ? { type: 'tool', toolName: choice.name }
    : choice;
}

function finishEvent(reason) {
  if (reason === 'stop') return { type: 'finish', reason: 'stop' };
  if (reason === 'length') return { type: 'finish', reason: 'length' };
  if (reason === 'tool-calls') return { type: 'finish', reason: 'tool_use' };
  if (reason === 'content-filter') return { type: 'finish', reason: 'content_filter' };
  return { type: 'failure', kind: 'protocol', code: 'provider_finish_' + reason, retryable: false };
}

function failureEvent(error, signal) {
  if (signal?.aborted) {
    return { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const retryable = status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
    return {
      type: 'failure',
      kind: 'provider',
      code: status === undefined ? 'provider_api_error' : 'provider_http_' + status,
      retryable,
    };
  }
  return { type: 'failure', kind: 'protocol', code: 'provider_protocol_error', retryable: false };
}

export function createOpenAiInference(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY.');
  const openai = createOpenAI({
    apiKey,
    baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  });
  const registry = createProviderRegistry({ openai });

  return {
    async *stream(request) {
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      const indexes = new Map();
      const textParts = new Map();
      const reasoningParts = new Map();
      let nextIndex = 0;
      let nextPartIndex = 0;
      try {
        const result = streamText({
          model: registry.languageModel('openai:' + request.model_id),
          messages: projectMessages(request.messages),
          tools: projectTools(request.tools),
          toolChoice: projectToolChoice(request.tool_choice),
          maxRetries: 0,
          stopWhen: stepCountIs(1),
          abortSignal: request.signal,
          onError: event => void event.error,
          ...(request.sampling.temperature !== undefined ? { temperature: request.sampling.temperature } : {}),
          ...(request.sampling.top_p !== undefined ? { topP: request.sampling.top_p } : {}),
          ...(request.sampling.max_output_tokens !== undefined ? { maxOutputTokens: request.sampling.max_output_tokens } : {}),
        });
        for await (const part of result.stream) {
          if (part.type === 'text-start') textParts.set(part.id, { index: nextPartIndex++, text: '' });
          if (part.type === 'text-delta') {
            const active = textParts.get(part.id);
            if (!active) throw new Error('Text delta has no matching start event.');
            active.text += part.text;
            if (part.text) yield { type: 'answer_delta', text: part.text };
          }
          if (part.type === 'text-end') {
            const active = textParts.get(part.id);
            if (!active) throw new Error('Text end has no matching start event.');
            if (active.text) yield { type: 'assistant_part_end', index: active.index, part: { type: 'text', text: active.text } };
            textParts.delete(part.id);
          }
          if (part.type === 'reasoning-start') reasoningParts.set(part.id, { index: nextPartIndex++, text: '' });
          if (part.type === 'reasoning-delta') {
            const active = reasoningParts.get(part.id);
            if (!active) throw new Error('Reasoning delta has no matching start event.');
            active.text += part.text;
            if (part.text) yield { type: 'thought_delta', text: part.text };
          }
          if (part.type === 'reasoning-end') {
            const active = reasoningParts.get(part.id);
            if (!active) throw new Error('Reasoning end has no matching start event.');
            yield { type: 'assistant_part_end', index: active.index, part: { type: 'reasoning', text: active.text } };
            reasoningParts.delete(part.id);
          }
          if (part.type === 'tool-input-start') {
            const index = nextIndex++;
            const partIndex = nextPartIndex++;
            indexes.set(part.id, { index, partIndex });
            yield { type: 'tool_call_start', index, part_index: partIndex, id: part.id, name: part.toolName };
          }
          if (part.type === 'tool-input-delta') {
            const active = indexes.get(part.id);
            if (!active) throw new Error('Tool delta has no matching start event.');
            if (part.delta) yield { type: 'tool_argument_delta', index: active.index, json_delta: part.delta };
          }
          if (part.type === 'tool-call') {
            let active = indexes.get(part.toolCallId);
            if (!active) {
              active = { index: nextIndex++, partIndex: nextPartIndex++ };
              yield { type: 'tool_call_start', index: active.index, part_index: active.partIndex, id: part.toolCallId, name: part.toolName };
            }
            yield {
              type: 'tool_call_end',
              index: active.index,
              call: { id: part.toolCallId, name: part.toolName, arguments: part.input },
            };
          }
          if (part.type === 'finish') {
            yield finishEvent(part.finishReason);
            return;
          }
          if (part.type === 'abort') {
            yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
            return;
          }
          if (part.type === 'error') {
            yield failureEvent(part.error, request.signal);
            return;
          }
        }
      } catch (error) {
        yield failureEvent(error, request.signal);
        return;
      }
      yield { type: 'failure', kind: 'protocol', code: 'provider_stream_truncated', retryable: false };
    },
  };
}
`;

export function createQuickstartTemplateFiles(projectName: string): TemplateFile[] {
  return [
    {
      path: 'package.json',
      content: `${JSON.stringify({
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          doctor: 'linnkit doctor',
          start: 'linnkit run hello --input "你好，介绍一下你自己"',
        },
        dependencies: {
          '@ai-sdk/openai': '^4.0.41',
          '@linnlabs/linnkit': '^0.16.0',
          ai: '^7.0.65',
        },
        devDependencies: {},
      }, null, 2)}\n`,
    },
    {
      path: '.env.example',
      content: [
        'OPENAI_API_KEY=',
        'OPENAI_BASE_URL=https://api.openai.com/v1',
        'OPENAI_MODEL=gpt-4.1-mini',
        '',
      ].join('\n'),
    },
    {
      path: 'agents/hello.mjs',
      content: [
        "import { defineAgent } from '@linnlabs/linnkit';",
        '',
        'export const helloAgent = defineAgent({',
        "  id: 'hello',",
        "  version: '0.1.0',",
        "  description: 'A tiny hello-world linnkit agent.',",
        "  modelId: process.env.OPENAI_MODEL || 'gpt-4.1-mini',",
        "  systemPrompt: 'You are a concise, warm assistant. Reply in the same language as the user.',",
        '  tools: [],',
        '  contextPolicy: {',
        "    profileId: 'agent',",
        '    contextTrace: { enabled: true },',
        '  },',
        '});',
        '',
      ].join('\n'),
    },
    { path: 'adapters/ai-sdk-openai.mjs', content: AI_SDK_ADAPTER },
    {
      path: 'linnkit.config.mjs',
      content: [
        "import { defineConfig } from '@linnlabs/linnkit';",
        "import { helloAgent } from './agents/hello.mjs';",
        "import { createOpenAiInference } from './adapters/ai-sdk-openai.mjs';",
        '',
        'export default defineConfig({',
        '  agents: [helloAgent],',
        '  defaultModelId: process.env.OPENAI_MODEL || helloAgent.modelId,',
        '  inference: () => createOpenAiInference(),',
        '});',
        '',
      ].join('\n'),
    },
    {
      path: 'README.md',
      content: [
        `# ${projectName}`,
        '',
        'A minimal linnkit quickstart project using the Vercel AI SDK Provider Registry.',
        '',
        '```bash',
        'cp .env.example .env',
        'npm install',
        'export OPENAI_API_KEY=...',
        'npx linnkit doctor',
        'npx linnkit run hello --input "你好"',
        '```',
        '',
      ].join('\n'),
    },
  ];
}
