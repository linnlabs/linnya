import { promises as fs } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { z } from 'zod';

export async function writeApprovalModelCatalog(target: string, url: string): Promise<void> {
  await fs.writeFile(
    target,
    JSON.stringify({
      models: [
        {
          id: 'approval-fixture',
          model_name: 'approval-fixture',
          catalog_source: 'default',
          capabilities: ['chat'],
          ui_visibility: ['chat'],
          display_name: 'Approval fixture',
          inference_route: {
            api_surface: 'openai_chat_completions',
            capability_id: 'ai-sdk:openai-compatible',
            endpoint_id: 'fixture',
            endpoint_model_id: 'approval-fixture',
            base_url: url,
            auth_profile: 'none',
            context_window_tokens: 32768,
            max_output_tokens: 4096,
            input_support: { user_image: false, tool_result_image: false },
            usage: { response_usage: 'provider_reported_optional' },
            // 夹具只发普通文本与 tool_calls，不宣称供应商专属 reasoning continuation。
            continuation: { tool_replay: 'unavailable' },
          },
        },
      ],
    })
  );
}

export async function startApprovalModelFixture(
  options: { holdFirstToolReply?: boolean } = {}
): Promise<{
  readonly url: string;
  readonly server: Server;
  heldResponseClosed(): boolean;
  command: string;
  readonly toolResults: string[];
}> {
  // 递归删除不存在的夹具目录，触发真实固定风险审批；不触及用户文件或真实供应商。
  // 本会话目录里的裸 rm -f 普通文件不再审批，所以这里必须用 -r。
  const state = { command: 'rm -rf approval-e2e-missing-dir; printf approval-e2e-executed' };
  const toolResults: string[] = [];
  let closed = false;
  const requestSchema = z
    .object({
      messages: z.array(
        z
          .object({
            role: z.string(),
            content: z.unknown().optional(),
          })
          .passthrough()
      ),
    })
    .passthrough();
  const server = createHttpServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const parsed = requestSchema.parse(JSON.parse(body));
      const result = parsed.messages.filter(message => message.role === 'tool').at(-1);
      if (result) {
        toolResults.push(JSON.stringify(result.content));
        if (options.holdFirstToolReply && toolResults.length === 1) {
          response.once('close', () => {
            closed = true;
          });
          return;
        }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = result
        ? { content: 'Fixture completed.' }
        : {
            tool_calls: [
              {
                index: 0,
                id: 'fixture-shell-call',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: state.command }) },
              },
            ],
          };
      const frame = (value: unknown): void => {
        response.write(`data: ${JSON.stringify(value)}\n\n`);
      };
      frame({
        id: 'fixture-completion',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'approval-fixture',
        choices: [{ index: 0, delta, finish_reason: null }],
      });
      frame({
        id: 'fixture-completion',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'approval-fixture',
        choices: [{ index: 0, delta: {}, finish_reason: result ? 'stop' : 'tool_calls' }],
      });
      response.end('data: [DONE]\n\n');
    } catch (error: unknown) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Model fixture is unavailable');
  return {
    server,
    heldResponseClosed: () => closed,
    url: `http://127.0.0.1:${address.port}/v1`,
    get command() {
      return state.command;
    },
    set command(value: string) {
      state.command = value;
    },
    toolResults,
  };
}
