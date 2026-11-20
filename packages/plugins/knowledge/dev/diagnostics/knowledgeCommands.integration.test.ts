import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { KnowledgeSearchResultSchema } from '@app/schemas';
import { CustomCapabilityModelCommandSchema } from '@app/schemas/custom-api-onboarding';
import { buildCustomCapabilityRegistration } from 'src/app-hosts/linnya/application/custom-api-onboarding/functions/buildCustomCapabilityRegistration';
import { createEmbeddingPort } from 'src/app-hosts/linnya/adapters/inference/orchestration/createEmbeddingPort';
import { createRerankingPort } from 'src/app-hosts/linnya/adapters/inference/orchestration/createRerankingPort';
import { resolveEmbeddingSpaceId } from 'src/app-hosts/linnya/adapters/inference/functions/resolveEmbeddingSpaceId';
import { runDiagnosticSearch } from './runDiagnosticSearch';
import {
  KNOWLEDGE_BASE_SCHEMAS,
  KNOWLEDGE_GRAPH_SCHEMAS,
} from '../../src/backend/database/schemas';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../../..');
const require = createRequire(import.meta.url);
const requests: { method: string; path: string; body: unknown }[] = [];
let root: string;
let database: Database.Database;
let server: Server;
let url: string;
const graphTables = [
  'knowledge_graph_nodes',
  'knowledge_graph_edges',
  'knowledge_graph_doc_status',
  'knowledge_graph_index_status',
  'knowledge_graph_vector_doc_status',
];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-developer-'));
  await mkdir(path.join(root, 'workspace'));
  const sot = path.join(root, 'Plugins/knowledge/source_of_truth');
  await mkdir(sot, { recursive: true });
  database = new Database(path.join(root, 'workspace/workspace.sqlite'));
  database.exec(
    'CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT, description TEXT, system_role TEXT, created_at INTEGER, deleted_at INTEGER)'
  );
  for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) database.exec(ddl);
  database
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?,NULL)')
    .run('project-a', 'A', null, 'default', 1);
  database
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?,NULL)')
    .run('project-b', 'B', null, null, 2);
  database
    .prepare('INSERT INTO projects VALUES (?,?,?,?,?,NULL)')
    .run('project-empty', 'Empty', null, null, 3);
  for (const id of ['default', 'a', 'b']) {
    database.prepare('INSERT INTO knowledge_bases(id,name,created_at) VALUES (?,?,1)').run(id, id);
    database
      .prepare(
        "INSERT INTO kb_documents(id,kb_id,filename,status,created_at) VALUES (?,?,?,'completed','2026-11-01')"
      )
      .run(`doc-${id}`, id, `${id}.md`);
    await writeFile(
      path.join(sot, `doc-${id}.source.json`),
      JSON.stringify({
        doc_id: `doc-${id}`,
        doc_title: `${id}.md`,
        metadata: {},
        content_blocks: { block: { block_type: 'paragraph', text: `${id} source text` } },
        structure: { root: ['block'] },
      })
    );
    database
      .prepare(
        "INSERT INTO knowledge_graph_nodes(kb_id,id,name,canonical_name,source_doc_id,source_block_id,created_at) VALUES (?,'node','苹果','苹果',?,'block',1)"
      )
      .run(id, `doc-${id}`);
    database
      .prepare(
        "INSERT INTO knowledge_graph_edges(kb_id,id,source_entity_id,target_entity_id,relation_type,evidence_doc_id,evidence_block_id,created_at) VALUES (?,'edge','node','node','related',?,'block',1)"
      )
      .run(id, `doc-${id}`);
    database
      .prepare("INSERT INTO knowledge_graph_doc_status VALUES (?,?,1,1,'completed',1)")
      .run(id, `doc-${id}`);
    database.prepare('INSERT INTO knowledge_graph_index_status VALUES (?,1,1,1)').run(id);
    database
      .prepare(
        "INSERT INTO knowledge_graph_vector_doc_status(kb_id,doc_id,embedding_model_id,node_count,edge_count,status,updated_at) VALUES (?,?,'embedding',1,1,'completed',1)"
      )
      .run(id, `doc-${id}`);
  }
  database
    .prepare("INSERT INTO project_knowledge_base_links VALUES (?, ?, 'read_only', 1, 1)")
    .run('project-a', 'a');
  database
    .prepare("INSERT INTO project_knowledge_base_links VALUES (?, ?, 'read_write', 1, 1)")
    .run('project-b', 'b');
  requests.length = 0;
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const body: unknown = text ? JSON.parse(text) : null;
    const pathname = new URL(request.url ?? '/', 'http://fixture.local').pathname;
    requests.push({ method: request.method ?? '', path: pathname, body });
    if (pathname === '/v1/embeddings') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
          model: 'fixture-embedding',
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      );
      return;
    }
    const collection = pathname.split('/')[2];
    let result: unknown = true;
    if (pathname.endsWith('/points/search'))
      result = [
        {
          id: 1,
          score: collection === 'b' ? 0.9 : 0.8,
          payload: {
            doc_id: `doc-${collection}`,
            block_id: 'block',
            doc_title: `${collection}.md`,
            document: `${collection} source text`,
            block_type: 'paragraph',
          },
        },
      ];
    else if (pathname.endsWith('/exists')) result = { exists: true };
    else if (pathname.endsWith('/points/count')) result = { count: 1 };
    else if (pathname.endsWith('/points/scroll'))
      result = {
        points: [
          {
            id: 1,
            payload: {
              doc_id: 'doc-a',
              block_id: 'block',
              document: 'private body',
              doc_title: 'a.md',
            },
            vector: { default: [0.1, 0.2] },
          },
        ],
        next_page_offset: null,
      };
    else if (request.method === 'GET')
      result = {
        points_count: 1,
        indexed_vectors_count: 1,
        segments_count: 1,
        config: { optimizer_config: { default_segment_number: 1 } },
      };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ result, status: 'ok', time: 0 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server missing address');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  database.close();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  await rm(root, { recursive: true, force: true });
});

async function run(script: string, args: string[]) {
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), script, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => {
    stdout += data.toString();
  });
  child.stderr.on('data', data => {
    stderr += data.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { code, stdout, stderr };
}
const searchEntry = 'scripts/e2e/knowledge-base/knowledge-search.e2e.ts';
function workspaceArgs() {
  return ['--workspaceDb', database.name, '--workspaceRoot', root, '--qdrantUrl', url];
}
function resultFrom(stdout: string) {
  const lines = stdout.split('\n').filter(line => line.startsWith('{"data":'));
  return KnowledgeSearchResultSchema.parse(JSON.parse(lines[lines.length - 1] ?? 'null'));
}

it('原开发搜索入口可帮助、列项目和关联，缺失库不创建新数据', async () => {
  const help = await run(searchEntry, ['--help']);
  expect(help, help.stderr).toMatchObject({ code: 0 });
  expect(help.stdout).toContain('--noAi');
  const projects = await run(searchEntry, ['list-projects', '--all', ...workspaceArgs()]);
  expect(projects, projects.stderr).toMatchObject({ code: 0 });
  expect(projects.stdout).toContain('project-b');
  const links = await run(searchEntry, ['list-project-kbs', 'project-a', ...workspaceArgs()]);
  expect(links, links.stderr).toMatchObject({ code: 0 });
  expect(links.stdout).toContain('kb_id: a');
  const missing = await run(searchEntry, [
    'list-projects',
    '--workspaceDb',
    path.join(root, 'missing.sqlite'),
  ]);
  expect(missing.code).toBe(1);
  await expect(readFile(path.join(root, 'missing.sqlite'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(requests).toHaveLength(0);
}, 30000);

it('原搜索命令实跑 BM25/图谱/多库聚合，项目越界拒绝且诊断不写数据库或历史证据', async () => {
  const before = await readFile(database.name);
  const base = [
    'search',
    '--projectId',
    'project-a',
    '--query',
    '苹果',
    '--print',
    'json',
    '--noAi',
    ...workspaceArgs(),
  ];
  const full = await run(searchEntry, [...base, '--graph', 'full']);
  expect(full, full.stderr).toMatchObject({ code: 0 });
  const parsed = resultFrom(full.stdout);
  expect(parsed.data.citations.citations.map(item => item.docId)).toEqual(['doc-a']);
  expect(parsed.observation).toContain('a source text');
  expect(parsed.observation).toContain('苹果');
  expect(requests).toHaveLength(1);
  expect(
    z.object({ vector: z.object({ name: z.literal('bm25') }) }).parse(requests[0].body).vector.name
  ).toBe('bm25');
  expect(await readFile(database.name)).toEqual(before);
  const denied = await run(searchEntry, [...base, '--docId', 'doc-b']);
  expect(denied.code).toBe(1);
  expect(denied.stderr).toContain('禁止跨项目');
  expect(requests).toHaveLength(1);
  const document = await run(searchEntry, [...base, '--docId', 'doc-a', '--graph', 'off']);
  expect(document, document.stderr).toMatchObject({ code: 0 });
  expect(resultFrom(document.stdout).data.search_mode).toBe('document');
  database
    .prepare("INSERT INTO project_knowledge_base_links VALUES ('project-a','b','read_only',2,2)")
    .run();
  const aggregate = await run(searchEntry, [...base, '--topK', '1']);
  expect(aggregate, aggregate.stderr).toMatchObject({ code: 0 });
  expect(resultFrom(aggregate.stdout).data.citations.citations.map(item => item.docId)).toEqual([
    'doc-b',
  ]);
  const fallback = await run(searchEntry, [
    'search',
    '--projectId',
    'project-empty',
    '--query',
    '苹果',
    '--no-ai',
    '--print',
    'json',
    ...workspaceArgs(),
  ]);
  expect(fallback, fallback.stderr).toMatchObject({ code: 0 });
  expect(resultFrom(fallback.stdout).data.citations.citations[0].docId).toBe('doc-default');
}, 60000);

it('两个维护入口实跑仅目标库：向量重置保留抽取，全重置保留第二库、原文和文档身份', async () => {
  const sourcePath = path.join(root, 'Plugins/knowledge/source_of_truth/doc-a.source.json');
  const source = await readFile(sourcePath);
  const vectors = await run('scripts/maintenance/knowledge-base/reset-knowledge-graph-vectors.ts', [
    '--kbId',
    'a',
    '--withQdrant',
    ...workspaceArgs(),
  ]);
  expect(vectors, vectors.stderr).toMatchObject({ code: 0 });
  expect(
    database.prepare('SELECT kb_id FROM knowledge_graph_vector_doc_status ORDER BY kb_id').all()
  ).toEqual([{ kb_id: 'b' }, { kb_id: 'default' }]);
  expect(
    database.prepare("SELECT id FROM knowledge_graph_nodes WHERE kb_id='a'").all()
  ).toHaveLength(1);
  expect(
    requests.filter(request => request.method === 'DELETE').map(request => request.path)
  ).toEqual(['/collections/kg_nodes_a', '/collections/kg_edges_a']);
  const full = await run('scripts/maintenance/knowledge-base/reset-knowledge-graph.ts', [
    '--kbId',
    'a',
    ...workspaceArgs(),
  ]);
  expect(full, full.stderr).toMatchObject({ code: 0 });
  for (const table of graphTables) {
    expect(database.prepare(`SELECT kb_id FROM ${table} WHERE kb_id='a'`).all()).toHaveLength(0);
    expect(database.prepare(`SELECT kb_id FROM ${table} WHERE kb_id='b'`).all()).toHaveLength(1);
  }
  expect(database.prepare('SELECT id FROM kb_documents ORDER BY id').all()).toEqual([
    { id: 'doc-a' },
    { id: 'doc-b' },
    { id: 'doc-default' },
  ]);
  expect(await readFile(sourcePath)).toEqual(source);
}, 30000);

it('普通搜索复用正式模型路由和稀疏/稠密检索，模型空间不匹配在联网前拒绝', async () => {
  const command = CustomCapabilityModelCommandSchema.parse({
    api_format: 'openai_embeddings',
    provider_name: 'fixture',
    base_url: `${url}/v1`,
    api_key: 'synthetic-key',
    endpoint_model_id: 'fixture-embedding',
  });
  const { model } = buildCustomCapabilityRegistration(command, 'fixture', 'fixture');
  if (!model.embedding_route) throw new Error('fixture route missing');
  database
    .prepare('UPDATE knowledge_bases SET embedding_model_id=?,embedding_space_id=? WHERE id=?')
    .run(model.id, resolveEmbeddingSpaceId(model.embedding_route), 'a');
  const catalog = {
    async initialize() {},
    getModel: () => model,
    resolveCredential: () => 'synthetic-key',
  };
  const input = {
    database,
    workspaceRoot: root,
    projectId: 'project-a',
    query: '苹果',
    topK: 3,
    graphMode: 'off' as const,
    noAi: false,
    qdrantUrl: url,
    initializeModels: async () => ({
      embedding: createEmbeddingPort({ catalog }),
      reranking: createRerankingPort({ catalog }),
    }),
  };
  const result = await runDiagnosticSearch(input);
  expect(result.data.citations.citations.map(item => item.docId)).toEqual(['doc-a']);
  expect(requests.filter(request => request.path === '/v1/embeddings')).toHaveLength(1);
  expect(requests.filter(request => request.path.endsWith('/points/search'))).toHaveLength(2);
  database.prepare('UPDATE knowledge_bases SET embedding_space_id=? WHERE id=?').run('stale', 'a');
  const count = requests.length;
  await expect(runDiagnosticSearch(input)).rejects.toThrow('重建');
  expect(requests).toHaveLength(count);
}, 30000);

it('原向量观察命令使用同一 Qdrant 协议且不读取 Workspace，抽样不泄露正文', async () => {
  const info = await run(searchEntry, ['qdrant-info', '--kbId', 'a', '--qdrantUrl', url]);
  expect(info, info.stderr).toMatchObject({ code: 0 });
  expect(info.stdout).toContain('target_segment_number=1');
  const count = await run(searchEntry, [
    'qdrant-count',
    '--collection',
    'a',
    '--blockType',
    'paragraph',
    '--qdrantUrl',
    url,
  ]);
  expect(count, count.stderr).toMatchObject({ code: 0 });
  expect(count.stdout).toContain('count=1');
  const peek = await run(searchEntry, [
    'qdrant-peek',
    '--collection',
    'a',
    '--limit',
    '1',
    '--qdrantUrl',
    url,
  ]);
  expect(peek, peek.stderr).toMatchObject({ code: 0 });
  expect(peek.stdout).toContain('doc-a');
  expect(peek.stdout).not.toContain('private body');
  expect(requests.map(request => request.path)).toEqual([
    '/collections/a',
    '/collections/kg_nodes_a',
    '/collections/kg_edges_a',
    '/collections/a/points/count',
    '/collections/a/points/scroll',
  ]);
}, 30000);
