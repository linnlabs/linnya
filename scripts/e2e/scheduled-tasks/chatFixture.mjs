import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * 本机回环 OpenAI-compatible 对话端点：只替换外部模型服务，鉴权、流与运行持久化走被测 App。
 * `holdMs` 让下一次回答先等一会儿，用来制造“运行中”的窗口（例如运行中删除任务）。
 */
export async function startChatFixture() {
  const apiKey = `scheduled-fixture-${randomUUID()}`;
  const requests = [];
  const errors = [];
  /** 回答前就被 App 断开的请求（运行被停止或取消）。 */
  let aborted = 0;
  let holdMs = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${apiKey}`) throw new Error('fixture credential mismatch');
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'scheduled-fixture', object: 'model' }] }));
        return;
      }
      if (request.url !== '/v1/chat/completions') throw new Error(`unexpected route ${request.url}`);
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      requests.push({ at: Date.now(), stream: parsed.stream === true });
      const wait = holdMs;
      holdMs = 0;
      if (wait > 0) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, wait);
          response.once('close', () => { clearTimeout(timer); resolve(); });
        });
      }
      if (response.destroyed || response.writableEnded) {
        aborted += 1;
        return;
      }
      const base = { id: `fixture-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model: 'scheduled-fixture' };
      const text = 'Scheduled acceptance answer.';
      if (parsed.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ...base, object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      }
    } catch (error) {
      errors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end('fixture failure');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    apiKey,
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    errors,
    holdNext(ms) { holdMs = ms; },
    get aborted() { return aborted; },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    },
  };
}
