import { afterEach, describe, expect, it } from 'vitest';

import {
  getIngestionProgress,
  ingestionProgressStore,
} from '../store/ingestionProgressStore';
import {
  syncCompletionToIngestionStore,
  syncProgressToIngestionStore,
} from '../orchestration/workerIngestionProgressProjection';

const docId = 'ingestion-progress-test-doc';
const graphDocId = 'graph-progress-test-doc';

describe('ingestion progress projection', () => {
  afterEach(() => {
    ingestionProgressStore.deleteState(docId);
    ingestionProgressStore.deleteState(graphDocId);
  });

  it('保持进度单调，并把完成结果投影为 100%', () => {
    syncProgressToIngestionStore({
      doc_id: docId,
      filename: 'report.pdf',
      status: 'processing',
      message: '正在解析',
      stage: 'parsing',
      progress: 40,
      stage_progress: 80,
    });
    syncProgressToIngestionStore({
      doc_id: docId,
      filename: 'report.pdf',
      status: 'processing',
      message: '开始向量化',
      stage: 'embedding',
      progress: 30,
      stage_progress: 10,
    });

    expect(getIngestionProgress(docId)).toMatchObject({
      status: 'processing',
      stage: 'embedding',
      progress: 40,
      stage_progress: 10,
    });

    syncCompletionToIngestionStore({
      docId,
      frontendState: { filename: 'report.pdf' },
    });

    expect(getIngestionProgress(docId)).toMatchObject({
      status: 'completed',
      progress: 100,
      stage: 'completed',
      stage_progress: 100,
    });
  });

  it('拒绝带 doc_id 但状态契约不完整的 Worker 进度', () => {
    expect(() => syncProgressToIngestionStore({
      doc_id: docId,
      filename: 'report.pdf',
      status: 'unknown',
    })).toThrow('frontendState 缺少合法 status/message');
  });

  it('不把非摄取 Worker 消息写入摄取进度读模型', () => {
    syncProgressToIngestionStore({
      docId: graphDocId,
      status: 'processing',
      message: '正在抽取图谱',
      progress: 50,
    });

    expect(getIngestionProgress(graphDocId)).toBeNull();
  });
});
