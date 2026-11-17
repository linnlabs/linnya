import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CitationSnapshotBundleRecordV1Schema } from '@app/schemas';
import { createHistoricalCitationSnapshotRouter } from '../../../../../electron-main/routes/historicalCitationSnapshotRouter';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../../../shared/utils/pathManager';
import { writeHistoricalCitationSnapshotFixture } from './historicalCitationSnapshotFixture';

describe('historical citation HTTP without a live knowledge service', () => {
  let server: Server | undefined;
  let root: string | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => {
      server?.close(error => error ? reject(error) : resolve());
    });
    resetWorkspaceRootToDefault();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('知识库不可用时仍可回放和下载当前会话历史，不能读到另一会话的文件', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-citation-history-http-'));
    setWorkspaceRoot(root);
    const { bundleId } = await writeHistoricalCitationSnapshotFixture({
      conversationId: 'conversation-a',
      instanceId: 'default',
      query: '历史资料',
      result: {
        data: {
          documents: [], search_mode: 'global', doc_name: null,
          query: '历史资料', display_title: '历史资料',
          citations: { query: '历史资料', searchMode: 'global', citations: [] },
        },
        observation: '已经保存的搜索结果',
      },
    });
    const app = express();
    app.use('/api/v1/knowledge-base', createHistoricalCitationSnapshotRouter());
    app.use('/api/v1/knowledge-base', (_request, response) => {
      response.status(503).json({ error: '知识库已停用' });
    });
    server = createServer(app);
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('未取得测试 HTTP 端口');
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/knowledge-base`;
    const snapshotUrl = `${baseUrl}/citation-snapshots/bundles/${bundleId}`;
    expect((await fetch(baseUrl)).status).toBe(503);
    const read = await fetch(`${snapshotUrl}?conversation_id=conversation-a`);
    expect(read.status).toBe(200);
    const record = CitationSnapshotBundleRecordV1Schema.parse(await read.json());
    expect(record.result.observation).toBe('已经保存的搜索结果');
    const download = await fetch(`${snapshotUrl}?conversation_id=conversation-a&download=1`);
    expect(download.headers.get('content-disposition')).toContain(`citation_snapshot_${bundleId}.json`);
    expect(CitationSnapshotBundleRecordV1Schema.parse(await download.json())).toEqual(record);
    expect((await fetch(snapshotUrl)).status).toBe(400);
    expect((await fetch(`${snapshotUrl}?conversation_id=conversation-b`)).status).toBe(500);
  });
});
