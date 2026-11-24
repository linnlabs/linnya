import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { QdrantClient } from '@qdrant/js-client-rest';
import { afterEach, describe, expect, it } from 'vitest';
import { QdrantAdapter } from '../vector-store/QdrantAdapter';
import { QdrantRepositoryImpl } from '../QdrantRepositoryImpl';
import {
  isCollectionInitializingError,
  readCollectionWhenReady,
} from '../vector-store/collections/readCollectionWhenReady';

/**
 * 最小的 Qdrant HTTP 替身：存在检查先攒够 `waitForChecks` 个才一起回答，保证并发写入都看到“不存在”；
 * 第一次创建成功，之后的创建按真实 Qdrant 的格式返回 409。
 */
async function startQdrant(options: {
  waitForChecks: number;
  createStatus?: number;
  /** 建好后前 N 次读取按真实 Qdrant 返回“副本未就绪”的 500。 */
  initializingReads?: number;
  /** 建好后读取一律返回其他原因的 500。 */
  brokenReads?: boolean;
}) {
  let initializingReads = options.initializingReads ?? 0;
  let reads = 0;
  const created = new Map<string, { size: number; sparse: boolean }>();
  const creates: string[] = [];
  let parked: Array<() => void> = [];
  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const answerGet = (name: string, response: ServerResponse) => {
    const collection = created.get(name);
    if (!collection) {
      send(response, 404, {
        status: { error: `Not found: Collection \`${name}\` doesn't exist!` },
        time: 0,
      });
      return;
    }
    reads += 1;
    if (options.brokenReads) {
      send(response, 500, {
        status: { error: 'Service internal error: No such file or directory' },
        time: 0,
      });
      return;
    }
    if (initializingReads > 0) {
      initializingReads -= 1;
      send(response, 500, {
        status: { error: 'Service internal error: 0 of 0 read operations failed' },
        time: 0,
      });
      return;
    }
    send(response, 200, {
      result: {
        status: 'green',
        points_count: 0,
        segments_count: 1,
        config: {
          params: {
            vectors: { default: { size: collection.size, distance: 'Cosine' } },
            ...(collection.sparse ? { sparse_vectors: { bm25: {} } } : {}),
          },
        },
      },
      status: 'ok',
      time: 0,
    });
  };
  const readBody = async (request: IncomingMessage) => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return JSON.parse(text) as {
      vectors: { default: { size: number } };
      sparse_vectors?: Record<string, unknown>;
    };
  };
  const server = createServer((request, response) => {
    const name = decodeURIComponent(
      new URL(request.url ?? '/', 'http://localhost').pathname.split('/')[2] ?? ''
    );
    if (request.method === 'GET') {
      if (parked.length + 1 < options.waitForChecks && !created.has(name)) {
        parked.push(() => answerGet(name, response));
        return;
      }
      const waiting = parked;
      parked = [];
      answerGet(name, response);
      for (const answer of waiting) answer();
      return;
    }
    if (request.method === 'PUT') {
      void readBody(request).then(body => {
        creates.push(name);
        if (options.createStatus) {
          send(response, options.createStatus, {
            status: { error: 'Service internal error' },
            time: 0,
          });
          return;
        }
        if (created.has(name)) {
          send(response, 409, {
            status: { error: `Wrong input: Collection \`${name}\` already exists!` },
            time: 0,
          });
          return;
        }
        created.set(name, {
          size: body.vectors.default.size,
          sparse: body.sparse_vectors?.['bm25'] !== undefined,
        });
        send(response, 200, { result: true, status: 'ok', time: 0 });
      });
      return;
    }
    send(response, 404, { status: { error: 'unexpected route' }, time: 0 });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Qdrant fixture did not bind a TCP port');
  const adapter = new QdrantAdapter({ url: `http://127.0.0.1:${address.port}` });
  return {
    repository: new QdrantRepositoryImpl(async () => adapter),
    url: `http://127.0.0.1:${address.port}`,
    creates,
    created,
    readsAfterCreation: () => reads,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('多份文档同时写入一个新知识库', () => {
  it('两次写入都看到集合不存在：后到的创建收到 409，按已存在继续，两次都成功', async () => {
    const qdrant = await startQdrant({ waitForChecks: 2 });
    close = qdrant.close;
    await expect(
      Promise.all([
        qdrant.repository.getOrCreateCollection('kb-new', 4, 'Cosine', true),
        qdrant.repository.getOrCreateCollection('kb-new', 4, 'Cosine', true),
      ])
    ).resolves.toEqual([undefined, undefined]);
    expect(qdrant.creates).toEqual(['kb-new', 'kb-new']);
    expect(qdrant.created.get('kb-new')).toEqual({ size: 4, sparse: true });
  });

  it('五份同时写入：只建一次，其余四次的 409 都按已存在处理', async () => {
    const qdrant = await startQdrant({ waitForChecks: 5 });
    close = qdrant.close;
    const writes = Array.from({ length: 5 }, () =>
      qdrant.repository.getOrCreateCollection('kb-many', 4, 'Cosine', false)
    );
    await expect(Promise.all(writes)).resolves.toHaveLength(5);
    expect(qdrant.creates).toHaveLength(5);
    expect(qdrant.created.size).toBe(1);
  });

  it('后到者的向量维度与先建好的集合不同：不当成功，报索引不一致', async () => {
    const qdrant = await startQdrant({ waitForChecks: 2 });
    close = qdrant.close;
    const results = await Promise.allSettled([
      qdrant.repository.getOrCreateCollection('kb-mixed', 4, 'Cosine', true),
      qdrant.repository.getOrCreateCollection('kb-mixed', 8, 'Cosine', true),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && String(rejected.reason)).toMatch(
      /知识库索引与当前写入不一致/u
    );
  });

  it('创建遇到 409 以外的失败（Qdrant 500）：照常报错，不当成已存在', async () => {
    const qdrant = await startQdrant({ waitForChecks: 1, createStatus: 500 });
    close = qdrant.close;
    await expect(
      qdrant.repository.getOrCreateCollection('kb-broken', 4, 'Cosine', true)
    ).rejects.toThrow(/createCollection HTTP 500/u);
  });

  it('后到者收到 409 时集合还没就绪（读取 500）：等到就绪再继续，两次都成功', async () => {
    const qdrant = await startQdrant({ waitForChecks: 2, initializingReads: 3 });
    close = qdrant.close;
    await expect(
      Promise.all([
        qdrant.repository.getOrCreateCollection('kb-starting', 4, 'Cosine', true),
        qdrant.repository.getOrCreateCollection('kb-starting', 4, 'Cosine', true),
      ])
    ).resolves.toEqual([undefined, undefined]);
    expect(qdrant.readsAfterCreation()).toBeGreaterThan(3);
  });

  it('存在检查遇到正在创建的集合：等到就绪后回答存在', async () => {
    const qdrant = await startQdrant({ waitForChecks: 1, initializingReads: 2 });
    close = qdrant.close;
    await qdrant.repository.getOrCreateCollection('kb-checked', 4, 'Cosine', true);
    await expect(qdrant.repository.collectionExists('kb-checked')).resolves.toBe(true);
    expect(qdrant.readsAfterCreation()).toBe(3);
  });

  it('其他原因的 500 不等待，立即失败', async () => {
    const qdrant = await startQdrant({ waitForChecks: 1, brokenReads: true });
    close = qdrant.close;
    await qdrant.repository.getOrCreateCollection('kb-damaged', 4, 'Cosine', true);
    await expect(qdrant.repository.collectionExists('kb-damaged')).rejects.toThrow(
      /collectionExists failed/u
    );
    expect(qdrant.readsAfterCreation()).toBe(1);
  });

  it('集合一直没就绪：到期限后抛出 Qdrant 的原错误', async () => {
    const qdrant = await startQdrant({ waitForChecks: 1, initializingReads: 1_000_000 });
    close = qdrant.close;
    await qdrant.repository.getOrCreateCollection('kb-stuck', 4, 'Cosine', true);
    const client = new QdrantClient({ url: qdrant.url, checkCompatibility: false });
    const failure = await readCollectionWhenReady(client, 'kb-stuck', 150).catch(error => error);
    expect(isCollectionInitializingError(failure)).toBe(true);
    expect(qdrant.readsAfterCreation()).toBeGreaterThan(1);
  });
});
