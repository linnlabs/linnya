import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

import { renderQdrantConfig } from '../../../src/infra/adapters/vector-store/qdrant/index';

const binary = process.argv[2];
assert.ok(binary && isAbsolute(binary), 'Pass the absolute path to the bundled Qdrant 1.14.1 binary');
const platform = process.platform;
assert.ok(platform === 'darwin' || platform === 'win32');
const root = await mkdtemp(join(tmpdir(), 'lq-'));
const configPath = join(root, 'config.yaml');
const options = { vectors: { size: 4, distance: 'Cosine' }, optimizers_config: { default_segment_number: 1 } };

async function withQdrant(config: string, exercise: (url: string) => Promise<void>): Promise<void> {
  await writeFile(configPath, config);
  const child = spawn(binary, ['--config-path', configPath], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, QDRANT__TELEMETRY_DISABLED: 'true' },
  });
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
  const output = createInterface({ input: child.stdout });
  const exit = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    const url = await new Promise<string>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Qdrant exited before binding (${code}): ${stderr.join('')}`)));
      output.on('line', line => {
        const match = /actix_server::server: starting service: .*listening on: (127\.0\.0\.1:\d+)/u.exec(line);
        if (match) resolve(`http://${match[1]}`);
      });
      AbortSignal.timeout(20_000).addEventListener('abort', () => reject(new Error('Qdrant did not bind in 20 seconds')), { once: true });
    });
    await exercise(url);
  } finally {
    child.kill();
    await exit;
    output.close();
  }
}

async function api(url: string, route: string, method = 'GET', data?: object): Promise<unknown> {
  const response = await fetch(`${url}/collections/${route}`, {
    method,
    ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(15_000),
  });
  const result: unknown = await response.json();
  assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(result)}`);
  return result;
}

try {
  // 用旧制品配置的真实默认值落盘，随后让同一二进制读取修复后的生产配置。
  await withQdrant('service:\n  host: 127.0.0.1\n  http_port: 0\n  grpc_port: null\n', async url => {
    await api(url, 'legacy', 'PUT', options);
    await api(url, 'legacy/points?wait=true', 'PUT', { points: [{ id: 1, vector: [1, 0, 0, 0], payload: { source: 'legacy' } }] });
  });
  await withQdrant(renderQdrantConfig({ host: '127.0.0.1', httpPort: 0, platform }), async url => {
    await api(url, 'fresh', 'PUT', { ...options, sparse_vectors: { bm25: {} } });
    const fresh = await api(url, 'fresh');
    assert.partialDeepStrictEqual(fresh, { result: { config: {
      wal_config: { wal_capacity_mb: 16 },
      optimizer_config: { memmap_threshold: platform === 'win32' ? 1_000_000_000 : 20_000, max_optimization_threads: 1 },
    } } });
    const legacy = await api(url, 'legacy');
    assert.partialDeepStrictEqual(legacy, { result: { config: { wal_config: { wal_capacity_mb: 32 } } } });
    assert.partialDeepStrictEqual(await api(url, 'legacy/points/1'), { result: { id: 1, payload: { source: 'legacy' } } });
    for (const collection of ['fresh', 'legacy']) {
      await api(url, collection, 'DELETE');
      const response = await fetch(`${url}/collections/${collection}`, { signal: AbortSignal.timeout(5_000) });
      await response.text();
      assert.equal(response.status, 404);
    }
    // Qdrant 将已删除集合改名后异步清目录，验证删除实际释放磁盘入口。
    const collectionsDir = join(root, 'storage', 'collections');
    for (let attempt = 0; attempt < 50 && (await readdir(collectionsDir)).length; attempt++) await sleep(100);
    assert.deepEqual(await readdir(collectionsDir), []);
  });
  console.log(`Qdrant ${platform}: new WAL/mmap/thread options applied, old WAL and payload preserved, collections deleted while running`);
} finally {
  await rm(root, { recursive: true });
}
