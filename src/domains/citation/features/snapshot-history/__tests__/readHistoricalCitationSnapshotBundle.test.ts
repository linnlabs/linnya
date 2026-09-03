import { afterEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathManager, resetWorkspaceRootToDefault, setWorkspaceRoot } from '@shared/utils/pathManager';
import { readHistoricalCitationSnapshotBundle } from '../infrastructure/readHistoricalCitationSnapshotBundle';
import { writeHistoricalCitationSnapshotFixture } from './historicalCitationSnapshotFixture';

describe('historical citation snapshot reader', () => {
  afterEach(() => {
    resetWorkspaceRootToDefault();
  });

  it('严格读取历史 Knowledge citation snapshot', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_citation_snapshot_store_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const { bundleId } = await writeHistoricalCitationSnapshotFixture({
        conversationId: 'conv_test',
        instanceId: 'inst_test',
        turnId: 'turn_test',
        query: '统一引用快照',
        args: { top_k: 10 },
        result: {
          data: {
            documents: [
              {
                id: 'doc-1:block-1',
                title: 'Doc One',
                snippet: '证据片段 A',
                doc_id: 'doc-1',
                doc_name: 'Doc One',
                block_id: 'block-1',
              },
            ],
            search_mode: 'global',
            doc_name: null,
            query: '统一引用快照',
            display_title: '搜索：统一引用快照',
            citations: {
              query: '统一引用快照',
              searchMode: 'global',
              citations: [
                {
                  ref: 'ABCdef',
                  index: 1,
                  sourceType: 'knowledge_base',
                  docId: 'doc-1',
                  blockId: 'block-1',
                  docTitle: 'Doc One',
                  snippet: '证据片段 A',
                },
              ],
            },
          },
          observation: '搜索结果 observation',
        },
      });

      const bundle = await readHistoricalCitationSnapshotBundle({
        conversationId: 'conv_test',
        instanceId: 'inst_test',
        bundleId,
      });
      expect(bundle.kind).toBe('citation_snapshot');
      expect(bundle.tool_name).toBe('search_knowledge_base');
      expect(bundle.citations).toHaveLength(1);
      expect(bundle.citations[0]?.ref).toBe('ABCdef');
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('历史 bundle 结构损坏时必须拒绝回放', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_invalid_citation_snapshot_'));
    setWorkspaceRoot(tmpRoot);
    const bundleId = 'badbadbadbadbad1';
    const filePath = pathManager.getConversationCitationSnapshotBundleFilePath({
      conversationId: 'conv_test',
      instanceId: 'default',
      bundleId,
    });

    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          kind: 'citation_snapshot',
          result: { data: {} },
        }),
        'utf-8',
      );

      await expect(
        readHistoricalCitationSnapshotBundle({
          conversationId: 'conv_test',
          bundleId,
        }),
      ).rejects.toThrow();
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
