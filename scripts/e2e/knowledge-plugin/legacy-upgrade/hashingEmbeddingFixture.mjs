import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export const HASHING_EMBEDDING_DIMENSION = 64;

/** 词袋哈希向量：同一文本在旧版与新版得到相同向量，含相同词的查询与文档余弦相近。 */
export function hashingEmbedding(text) {
  const vector = new Array(HASHING_EMBEDDING_DIMENSION).fill(0);
  const tokens = String(text).toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    vector[digest.readUInt16BE(0) % HASHING_EMBEDDING_DIMENSION] += digest[2] & 1 ? 1 : -1;
  }
  if (tokens.length === 0) vector[0] = 1;
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
}

/**
 * 本机回环 OpenAI-compatible 端点：只替换外部服务，鉴权、请求与持久化走被测 App 的正式实现。
 * 端口与密钥可固定，使旧版写入的模型配置在升级后仍指向同一端点。
 */
export async function startHashingEmbeddingFixture({ apiKey, port = 0 } = {}) {
  assert.ok(typeof apiKey === 'string' && apiKey.length >= 16, 'fixture api key');
  const requests = [];
  const errors = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${apiKey}`, 'persisted fixture credential');
      let body = '';
      for await (const chunk of request) body += chunk;
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'legacy-hash-embedding', object: 'model' }] }));
        return;
      }
      assert.equal(request.method, 'POST', `${request.method} ${url.pathname}`);
      if (url.pathname === '/v1/embeddings') {
        const parsed = JSON.parse(body);
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
        assert.ok(inputs.every(input => typeof input === 'string'), 'embedding inputs must be text');
        requests.push({ kind: 'embedding', model: parsed.model, inputs: inputs.length, at: Date.now(),
          sample: inputs.map(input => input.slice(0, 80)) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          object: 'list', model: parsed.model,
          data: inputs.map((input, index) => ({ object: 'embedding', index, embedding: hashingEmbedding(input) })),
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
        }));
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        // 旧版摄入不需要对话模型；标题等辅助请求若出现，给出最小合法回复并记账。
        requests.push({ kind: 'chat', at: Date.now() });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'legacy-fixture', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'legacy-hash-embedding',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Legacy fixture' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
        return;
      }
      throw new Error(`unexpected route ${url.pathname}`);
    } catch (error) {
      errors.push(error.message);
      response.writeHead(500).end('Fixture contract failed');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const boundPort = server.address().port;
  return {
    apiKey,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/v1`,
    requests,
    errors,
    embeddedInputs(since = 0) {
      return requests.filter(item => item.kind === 'embedding' && item.at >= since)
        .reduce((total, item) => total + item.inputs, 0);
    },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    },
  };
}
