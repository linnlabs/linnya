import { createServer, type IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { MODEL_CONNECTION_TEST_PNG } from '../../definitions/modelConnectionTestDocument';

export interface ProtocolRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const ChatRequestSchema = z.object({
  model: z.string(),
  stream: z.boolean().optional(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([
        z.string(),
        z.array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string() }),
            z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
          ])
        ),
      ]),
    })
  ),
});
export type ProtocolChatRequest = z.infer<typeof ChatRequestSchema>;

/** 官方 wire fixture，走真实 TCP 和已安装 Provider SDK；只供本机合成验收使用。 */
export async function startCustomCapabilityProtocolServer() {
  const requests: ProtocolRequest[] = [];
  let failure: 'unauthorized' | 'wrong_format' | 'none' = 'none';
  let baseUrl = '';
  let responseDelayMs = 0;
  let responseDelayPath: string | undefined;
  let cancelledRequests = 0;
  let chatResponse: (request: ProtocolChatRequest) => string = () =>
    'Synthetic apple orchard description';
  const layout = {
    result: { layoutParsingResults: [{ markdown: { text: 'Linnya model test 123' } }] },
  };
  const server = createServer(async (request, response) => {
    response.on('close', () => {
      if (!response.writableEnded) cancelledRequests += 1;
    });
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      headers: request.headers,
      body,
    });
    if (responseDelayMs && (!responseDelayPath || request.url === responseDelayPath))
      await new Promise(resolve => setTimeout(resolve, responseDelayMs));
    if (response.destroyed) return;
    response.setHeader('content-type', 'application/json');
    if (failure === 'unauthorized') {
      response.writeHead(401);
      response.end(JSON.stringify({ error: { message: 'fixture-upstream-secret' } }));
      return;
    }
    if (failure === 'wrong_format') {
      response.end(JSON.stringify({ text: 'not the requested protocol' }));
      return;
    }
    try {
      switch (`${request.method} ${request.url}`) {
        case 'POST /v1/embeddings': {
          const payload = z.object({ input: z.array(z.string()) }).parse(JSON.parse(body));
          response.end(
            JSON.stringify({
              object: 'list',
              data: payload.input.map((text, index) => ({
                object: 'embedding',
                index,
                embedding: [
                  text.toLowerCase().includes('apple') ? 1 : 0.01,
                  text.toLowerCase().includes('train') ? 1 : 0.01,
                  0.3,
                ],
              })),
              model: 'embedding-fixture',
              usage: { prompt_tokens: 5, total_tokens: 5 },
            })
          );
          return;
        }
        case 'POST /v2/rerank': {
          const payload = z
            .object({
              model: z.string(),
              query: z.string(),
              documents: z.array(z.string()),
              top_n: z.number().int().positive().optional(),
            })
            .parse(JSON.parse(body));
          response.end(
            JSON.stringify({
              id: 'rerank-fixture',
              results: payload.documents.slice(0, payload.top_n).map((_, index) => ({
                index,
                relevance_score: index === 0 ? 0.9 : 0.1 / index,
              })),
              meta: { billed_units: { search_units: 1 } },
            })
          );
          return;
        }
        case 'POST /v1/chat/completions': {
          const payload = ChatRequestSchema.parse(JSON.parse(body));
          const content = chatResponse(payload);
          const identity = { id: 'chat-fixture', created: 1_700_000_000, model: payload.model };
          if (payload.stream) {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            for (const choice of [
              { delta: { role: 'assistant', content }, finish_reason: null },
              { delta: {}, finish_reason: 'stop' },
            ]) {
              response.write(
                `data: ${JSON.stringify({ ...identity, object: 'chat.completion.chunk', choices: [{ index: 0, ...choice }] })}\n\n`
              );
            }
            response.end('data: [DONE]\n\n');
          } else {
            response.end(
              JSON.stringify({
                ...identity,
                object: 'chat.completion',
                choices: [
                  { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
                ],
              })
            );
          }
          return;
        }
        case 'POST /v1/images/generations':
          response.end(
            JSON.stringify({
              created: 1_700_000_000,
              data: [{ b64_json: MODEL_CONNECTION_TEST_PNG }],
            })
          );
          return;
        case 'POST /layout-parsing':
          response.end(JSON.stringify(layout));
          return;
        case 'POST /api/v2/ocr/jobs':
          response.end(JSON.stringify({ code: 0, msg: 'Success', data: { jobId: 'fixture-job' } }));
          return;
        case 'GET /api/v2/ocr/jobs/fixture-job':
          response.end(
            JSON.stringify({
              code: 0,
              data: {
                state: 'done',
                extractProgress: { totalPages: 1, extractedPages: 1 },
                resultUrl: { jsonUrl: `${baseUrl}/result.jsonl` },
              },
            })
          );
          return;
        case 'GET /result.jsonl':
          response.end(JSON.stringify(layout));
          return;
        default:
          response.writeHead(404);
          response.end(JSON.stringify({ error: { message: 'unexpected fixture endpoint' } }));
      }
    } catch (error) {
      response.writeHead(422);
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      );
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    requests,
    get cancelledRequestCount() {
      return cancelledRequests;
    },
    setDelay(milliseconds: number, path?: string) {
      responseDelayMs = milliseconds;
      responseDelayPath = path;
    },
    setFailure(value: typeof failure) {
      failure = value;
    },
    // 场景 owner 产生合成正文；这里仅负责官方 HTTP/SSE 传输，不能内置知识库规则。
    setChatResponse(respond: (request: ProtocolChatRequest) => string) {
      chatResponse = respond;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    },
  };
}
