import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DatabaseService } from '../../../../electron-main/services/database';
import { BetterSqliteKnowledgeGraphRepository } from '../infrastructure/better-sqlite-knowledge-graph.repository';

describe('BetterSqliteKnowledgeGraphRepository (M1)', () => {
  let tempDir: string;
  let dbPath: string;
  let databaseService: DatabaseService;
  let repo: BetterSqliteKnowledgeGraphRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-kg-'));
    dbPath = path.join(tempDir, 'workspace.sqlite');

    databaseService = new DatabaseService(dbPath);
    databaseService.initialize();

    // 预置一个 KB 记录（图谱表有 kb_id 的外键约束）
    const db = databaseService.getDb();
    db.prepare(`
      INSERT INTO knowledge_bases (
        id, name, description, tags_json,
        embedding_model_id, rerank_model_id, vision_model_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'kb-test',
      '测试知识库',
      '用于图谱仓储单测',
      null,
      null,
      null,
      null,
      Date.now() / 1000,
      Date.now() / 1000
    );

    repo = new BetterSqliteKnowledgeGraphRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('数据库初始化后应存在图谱表与核心索引', () => {
    const db = databaseService.getDb();

    const tableNames = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" +
          "'knowledge_graph_nodes'," +
          "'knowledge_graph_edges'," +
          "'knowledge_graph_doc_status'," +
          "'knowledge_graph_index_status'" +
          ')'
      )
      .all() as Array<{ name: string }>;

    expect(tableNames.map((t) => t.name).sort()).toEqual([
      'knowledge_graph_doc_status',
      'knowledge_graph_edges',
      'knowledge_graph_index_status',
      'knowledge_graph_nodes',
    ]);

    const indexNames = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IN (" +
          "'idx_kg_nodes_kb_canonical_name'," +
          "'idx_kg_edges_source_entity'," +
          "'idx_kg_edges_target_entity'," +
          "'idx_kg_edges_relation_type'," +
          "'idx_kg_edges_evidence'," +
          "'idx_kg_doc_status_kb_doc'" +
          ')'
      )
      .all() as Array<{ name: string }>;

    // 索引存在即可，不强制顺序
    expect(new Set(indexNames.map((i) => i.name))).toEqual(
      new Set([
        'idx_kg_nodes_kb_canonical_name',
        'idx_kg_edges_source_entity',
        'idx_kg_edges_target_entity',
        'idx_kg_edges_relation_type',
        'idx_kg_edges_evidence',
        'idx_kg_doc_status_kb_doc',
      ])
    );
  });

  it('应支持 nodes/edges 的幂等 upsert 与按证据/实体查询', async () => {
    await repo.upsertNodes([
      {
        kbId: 'kb-test',
        id: 'e-apple',
        name: 'Apple Inc.',
        canonicalName: 'apple-inc',
        type: 'Company',
        description: 'A company',
        sourceDocId: 'doc-1',
        sourceBlockId: 'b-1',
      },
      {
        kbId: 'kb-test',
        id: 'e-iphone',
        name: 'iPhone',
        canonicalName: 'iphone',
        type: 'Product',
        description: 'A product',
        sourceDocId: 'doc-1',
        sourceBlockId: 'b-2',
      },
    ]);

    await repo.upsertEdges([
      {
        kbId: 'kb-test',
        id: 'edge-1',
        sourceEntityId: 'e-apple',
        targetEntityId: 'e-iphone',
        relationType: 'produces',
        statement: 'Apple produces iPhone.',
        confidence: 0.9,
        evidenceDocId: 'doc-1',
        evidenceBlockId: 'b-2',
      },
    ]);

    // 幂等：重复 upsert 同一 edge id，应更新字段而不是插入重复记录
    await repo.upsertEdges([
      {
        kbId: 'kb-test',
        id: 'edge-1',
        sourceEntityId: 'e-apple',
        targetEntityId: 'e-iphone',
        relationType: 'produces',
        statement: 'Apple Inc. produces iPhone.',
        confidence: 0.95,
        evidenceDocId: 'doc-1',
        evidenceBlockId: 'b-2',
      },
    ]);

    const byEvidence = await repo.listEdgesByEvidence('kb-test', 'doc-1', ['b-2']);
    expect(byEvidence).toHaveLength(1);
    expect(byEvidence[0].id).toBe('edge-1');
    expect(byEvidence[0].statement).toBe('Apple Inc. produces iPhone.');
    expect(byEvidence[0].confidence).toBe(0.95);

    const outEdges = await repo.listEdgesByEntity('kb-test', 'e-apple', 'out');
    expect(outEdges.map((e) => e.id)).toEqual(['edge-1']);

    const inEdges = await repo.listEdgesByEntity('kb-test', 'e-iphone', 'in');
    expect(inEdges.map((e) => e.id)).toEqual(['edge-1']);

    const bothEdges = await repo.listEdgesByEntity('kb-test', 'e-iphone', 'both');
    expect(bothEdges.map((e) => e.id)).toEqual(['edge-1']);

    const nodes = await repo.getNodesByIds('kb-test', ['e-iphone', 'e-apple']);
    // 不强制顺序
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('e-apple')?.canonicalName).toBe('apple-inc');
    expect(byId.get('e-iphone')?.canonicalName).toBe('iphone');
  });

  it('删除文档时应清理该 doc 的 edges/doc_status，并仅删除孤儿 nodes', async () => {
    // doc-1 与 doc-2 共享同一节点 e-apple（通过 id 去重）
    await repo.upsertNodes([
      { kbId: 'kb-test', id: 'e-apple', name: 'Apple', canonicalName: 'apple', type: null, description: null, sourceDocId: 'doc-1', sourceBlockId: 'b-1' },
      { kbId: 'kb-test', id: 'e-supply', name: 'SupplyChain', canonicalName: 'supplychain', type: null, description: null, sourceDocId: 'doc-1', sourceBlockId: 'b-2' },
      { kbId: 'kb-test', id: 'e-fox', name: 'Foxconn', canonicalName: 'foxconn', type: null, description: null, sourceDocId: 'doc-2', sourceBlockId: 'b-9' },
    ]);

    await repo.upsertEdges([
      {
        kbId: 'kb-test',
        id: 'edge-1',
        sourceEntityId: 'e-apple',
        targetEntityId: 'e-supply',
        relationType: 'DEPENDS_ON',
        statement: 'Apple depends on supply chain',
        evidenceDocId: 'doc-1',
        evidenceBlockId: 'b-2',
      },
      {
        kbId: 'kb-test',
        id: 'edge-2',
        sourceEntityId: 'e-fox',
        targetEntityId: 'e-apple',
        relationType: 'DEPENDS_ON',
        statement: 'Foxconn depends on Apple',
        evidenceDocId: 'doc-2',
        evidenceBlockId: 'b-9',
      },
    ]);

    await repo.upsertDocStatus({
      kbId: 'kb-test',
      docId: 'doc-1',
      chunkCount: 2,
      doneChunks: 1,
      status: 'running',
    });

    const cleanup = await repo.deleteGraphDataForDocument('kb-test', 'doc-1');
    expect(cleanup.deletedEdges).toBe(1);
    expect(cleanup.deletedDocStatus).toBe(1);
    // e-supply 只在 doc-1 的边中出现，应被删除；e-apple 仍被 doc-2 的边引用，应保留
    expect(cleanup.deletedOrphanNodes).toBe(1);

    const remainingEdgesForDoc1 = await repo.listEdgesByEvidence('kb-test', 'doc-1', ['b-2']);
    expect(remainingEdgesForDoc1.length).toBe(0);

    const doc1Status = await repo.getDocStatus('kb-test', 'doc-1');
    expect(doc1Status).toBeUndefined();

    const remainingNodes = await repo.getNodesByIds('kb-test', ['e-apple', 'e-supply', 'e-fox']);
    const remainingIds = new Set(remainingNodes.map((n) => n.id));
    expect(remainingIds.has('e-apple')).toBe(true);
    expect(remainingIds.has('e-fox')).toBe(true);
    expect(remainingIds.has('e-supply')).toBe(false);
  });

  it('删除知识库（knowledge_bases）后，图谱表应被外键级联清理', async () => {
    await repo.upsertNodes([
      { kbId: 'kb-test', id: 'e-1', name: 'A', canonicalName: 'a', type: null, description: null, sourceDocId: 'doc-x', sourceBlockId: 'b-x' },
    ]);
    await repo.upsertEdges([
      {
        kbId: 'kb-test',
        id: 'edge-x',
        sourceEntityId: 'e-1',
        targetEntityId: 'e-1',
        relationType: 'RELATED_TO',
        statement: 'A relates to A',
        evidenceDocId: 'doc-x',
        evidenceBlockId: 'b-x',
      },
    ]);
    await repo.upsertDocStatus({ kbId: 'kb-test', docId: 'doc-x', chunkCount: 1, doneChunks: 1, status: 'completed' });

    const db = databaseService.getDb();
    db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run('kb-test');

    const nodesCount = (db.prepare('SELECT COUNT(1) as c FROM knowledge_graph_nodes WHERE kb_id = ?').get('kb-test') as { c: number }).c;
    const edgesCount = (db.prepare('SELECT COUNT(1) as c FROM knowledge_graph_edges WHERE kb_id = ?').get('kb-test') as { c: number }).c;
    const statusCount = (db.prepare('SELECT COUNT(1) as c FROM knowledge_graph_doc_status WHERE kb_id = ?').get('kb-test') as { c: number }).c;

    expect(nodesCount).toBe(0);
    expect(edgesCount).toBe(0);
    expect(statusCount).toBe(0);
  });

  it('应支持 doc_status 写入与 KB 级进度聚合（上传新文档会改变分母）', async () => {
    await repo.upsertDocStatus({
      kbId: 'kb-test',
      docId: 'doc-a',
      chunkCount: 100,
      doneChunks: 50,
      status: 'running',
    });

    const p1 = await repo.getKbProgress('kb-test');
    expect(p1.totalUnits).toBe(100);
    expect(p1.doneUnits).toBe(50);
    expect(p1.progress).toBe(0.5);

    // 新文档入队（分母变大，进度回落）
    await repo.upsertDocStatus({
      kbId: 'kb-test',
      docId: 'doc-b',
      chunkCount: 100,
      doneChunks: 0,
      status: 'queued',
    });

    const p2 = await repo.getKbProgress('kb-test');
    expect(p2.totalUnits).toBe(200);
    expect(p2.doneUnits).toBe(50);
    expect(p2.progress).toBe(0.25);

    // 更新 doc-a 进度
    await repo.updateDocProgress('kb-test', 'doc-a', 100, 'completed');
    const p3 = await repo.getKbProgress('kb-test');
    expect(p3.totalUnits).toBe(200);
    expect(p3.doneUnits).toBe(100);
    expect(p3.progress).toBe(0.5);
  });

  it('端到端进度：抽取完成但向量未写入时不应达到 100%', async () => {
    // 1) 先写入一些图谱产物（nodes/edges），保证“索引分母 > 0”
    await repo.upsertNodes([
      {
        kbId: 'kb-test',
        id: 'e-a',
        name: 'Apple Inc.',
        canonicalName: 'apple-inc',
        type: 'Company',
        description: 'A company',
        sourceDocId: 'doc-vec',
        sourceBlockId: 'b-1',
      },
      {
        kbId: 'kb-test',
        id: 'e-b',
        name: 'iPhone',
        canonicalName: 'iphone',
        type: 'Product',
        description: 'A product',
        sourceDocId: 'doc-vec',
        sourceBlockId: 'b-2',
      },
    ]);
    await repo.upsertEdges([
      {
        kbId: 'kb-test',
        id: 'edge-1',
        sourceEntityId: 'e-a',
        targetEntityId: 'e-b',
        relationType: 'RELATED_TO',
        statement: 'Apple produces iPhone.',
        confidence: 0.9,
        sentiment: null,
        time: null,
        evidenceDocId: 'doc-vec',
        evidenceBlockId: 'b-2',
      },
    ]);

    // 2) 抽取进度已完成（chunk done=chunk count）
    await repo.upsertDocStatus({
      kbId: 'kb-test',
      docId: 'doc-vec',
      chunkCount: 10,
      doneChunks: 10,
      status: 'completed',
    });

    // 3) 尚未写入向量（vector_doc_status 不存在）时：总进度 < 1
    const p1 = await repo.getKbProgress('kb-test');
    expect(p1.totalUnits).toBe(13); // 10 chunks + (2 nodes + 1 edge)
    expect(p1.doneUnits).toBe(10); // 仅抽取完成
    expect(p1.progress).toBeCloseTo(10 / 13, 6);

    // 4) 当向量索引完成（completed）后：进度才应达到 1
    await repo.upsertVectorDocStatus({
      kbId: 'kb-test',
      docId: 'doc-vec',
      embeddingModelId: 'emb-test',
      nodeCount: 2,
      edgeCount: 1,
      doneUnits: 3,
      status: 'completed',
      errorMessage: null,
    });

    const p2 = await repo.getKbProgress('kb-test');
    expect(p2.totalUnits).toBe(13);
    expect(p2.doneUnits).toBe(13);
    expect(p2.progress).toBe(1);
  });
});


