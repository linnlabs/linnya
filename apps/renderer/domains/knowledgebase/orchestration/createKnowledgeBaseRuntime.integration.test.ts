import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { useKnowledgeBase } from '../runtime.js';
import { stopAllAnimations } from '../services/progressAnimator.js';
import type { KnowledgeBaseRuntime } from '../definitions/knowledgeBaseRuntime';

type Receipt = { status: string; document: { id: string }; task_id: string };
type Status = { taskId?: string; docId?: string; kbId?: string; status: string; progress?: number; stage?: string; stage_progress?: number; timestamp?: number };
const api = vi.hoisted(() => ({
  getAllKnowledgeBases: vi.fn(async () => ({ knowledge_bases: [{ id: 'kb-1', name: 'Library', documentCount: 0, embeddingModelId: 'old-kb-embedding', rerankModelId: 'old-kb-rerank', pdfOcrModelId: 'old-kb-ocr', imageVisionModelId: 'old-kb-image' }, { id: 'kb-2', name: 'Other', documentCount: 9 }] })),
  getDocuments: vi.fn<(id: string) => Promise<{ documents: { id: string; kbId: string }[] }>>(async () => ({ documents: [] })),
  uploadDocument: vi.fn<(id: string, file: File, config: unknown, progress: unknown) => Promise<Receipt>>(async () => ({ status: 'pending', document: { id: 'doc-1' }, task_id: 'task-1' })),
  getTasksStatus: vi.fn(async () => ({})),
  cancelTask: vi.fn(async () => undefined),
}));
vi.mock('../services/knowledgeBaseService.js', () => ({ knowledgeBaseService: api }));
vi.mock('@/domains/model-configuration', () => ({
  readEffectiveModelPurposeBinding: (slot: string) => `${slot}-model`,
  readEffectiveAuxiliaryModelPurposeBinding: () => 'graph-model',
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  let reject: (reason: Error) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await nextTick();
}

describe('knowledge base runtime lifecycle and data flow', () => {
  let runtime: KnowledgeBaseRuntime | undefined;
  let listener: (update: Status) => void;
  let quit: () => void;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((callback: (update: Status) => void) => { listener = callback; return unsubscribe; });
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    vi.clearAllMocks();
    api.uploadDocument.mockImplementation(async () => ({ status: 'pending', document: { id: 'doc-1' }, task_id: 'task-1' }));
    api.getDocuments.mockImplementation(async () => ({ documents: [] }));
    subscribe.mockImplementation(callback => { listener = callback; return unsubscribe; });
    setActivePinia(createPinia());
    storage.clear();
    vi.stubGlobal('window', { electronAPI: { onTaskStatusUpdate: subscribe, onAppQuit: (callback: () => void) => { quit = callback; } } });
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });
  afterEach(() => {
    runtime?.cleanupIpcListener();
    runtime = undefined;
    stopAllAnimations();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('limits upload concurrency, replays early progress and uses the global model snapshot', async () => {
    const receipts: ReturnType<typeof deferred<Receipt>>[] = [];
    api.uploadDocument.mockImplementation(() => {
      const receipt = deferred<Receipt>(); receipts.push(receipt); return receipt.promise;
    });
    runtime = useKnowledgeBase();
    await runtime.fetchKnowledgeBases();
    const files = Array.from({ length: 6 }, (_, i) => new File(['pdf'], `source-${i}.pdf`));
    runtime.addFilesToQueue('kb-1', files);
    await runtime.startParsing();
    expect(api.uploadDocument).toHaveBeenCalledTimes(4);
    expect(api.uploadDocument).toHaveBeenCalledWith('kb-1', files[0], expect.objectContaining({
      embedding_model_id: 'embedding-model', rerank_model_id: 'rerank-model',
      pdf_ocr_model_id: 'pdf_ocr-model', image_vision_model_id: 'image_vision-model',
      graph_extraction_model_id: 'graph-model', vision_model_id: null, force_vision_mode: false,
    }), expect.any(Function));
    const task = [...runtime.uploadTasks.values()][0];
    listener({ taskId: 'early-task', docId: 'early-doc', status: 'duplicate', progress: 100, timestamp: Date.now() });
    receipts[0].resolve({ status: 'pending', document: { id: 'early-doc' }, task_id: 'early-task' });
    await settle();
    expect(runtime.pendingUpdatesByTaskId.size).toBe(0);
    expect(runtime.uploadTasks.get(task.id)).toMatchObject({ docId: 'early-doc', backendTaskId: 'early-task', status: 'duplicate', displayProgress: 100 });
    expect(api.uploadDocument).toHaveBeenCalledTimes(5);
    // 终态不能被迟到的处理中状态倒退。
    listener({ docId: 'early-doc', status: 'processing', stage: 'parsing', stage_progress: 1, timestamp: Date.now() + 1000 });
    expect(runtime.uploadTasks.get(task.id)?.status).toBe('duplicate');
  });

  it('cancels by backend task identity, then retries the same visible task', async () => {
    runtime = useKnowledgeBase();
    runtime.addFilesToQueue('kb-1', [new File(['text'], 'source.txt')]);
    await runtime.startParsing(); await settle();
    const task = [...runtime.uploadTasks.values()][0];
    await runtime.cancelUploadTask(task.id);
    expect(api.cancelTask).toHaveBeenCalledWith('task-1');
    expect(runtime.uploadTasks.get(task.id)?.status).toBe('failed');
    await runtime.retryUploadTask(task.id); await settle();
    expect(api.uploadDocument).toHaveBeenCalledTimes(2);
    expect(runtime.uploadTasks.size).toBe(1);
    expect(runtime.uploadTasks.get(task.id)?.status).toBe('processing');
    runtime.deleteUploadTask(task.id);
    expect(runtime.uploadTasks.size).toBe(0);
  });

  it('keeps the newest document response when an older request fails late', async () => {
    const older = deferred<{ documents: { id: string; kbId: string }[] }>();
    const newer = deferred<{ documents: { id: string; kbId: string }[] }>();
    api.getDocuments.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    runtime = useKnowledgeBase();
    const oldLoad = runtime.fetchDocuments('kb-1');
    const newLoad = runtime.fetchDocuments('kb-2');
    newer.resolve({ documents: [{ id: 'new-document', kbId: 'kb-2' }] }); await newLoad;
    older.reject(new Error('old request failed')); await oldLoad;
    expect(runtime.documents).toEqual([{ id: 'new-document', kbId: 'kb-2' }]);
    expect(runtime.isLoading).toBe(false);
    expect(runtime.error).toBeNull();
  });

  it('keeps application watchers after the first consumer leaves, and projects only the selected KB count', async () => {
    storage.set('kb_parsing_settings', JSON.stringify({ forceVisionMode: true }));
    const consumer = effectScope();
    const created = consumer.run(() => useKnowledgeBase());
    if (!created) throw new Error('Test consumer scope did not run');
    runtime = created;
    consumer.stop();
    expect(runtime).toBe(useKnowledgeBase());
    expect(runtime.parsingSettings.forceVisionMode).toBe(true);
    await runtime.fetchKnowledgeBases();
    api.getDocuments.mockResolvedValue({ documents: [{ id: 'a', kbId: 'kb-1' }, { id: 'b', kbId: 'kb-1' }, { id: 'c', kbId: 'kb-2' }] });
    runtime.setCurrentKnowledgeBase('kb-1'); await settle();
    expect(runtime.getKnowledgeBaseById('kb-1')?.documentCount).toBe(2);
    expect(runtime.getKnowledgeBaseById('kb-2')?.documentCount).toBe(9);
    runtime.setCurrentKnowledgeBase(null); await settle();
    expect(runtime.documents).toEqual([]);
    runtime.updateParsingSettings({ forceVisionMode: false });
    expect(JSON.parse(storage.get('kb_parsing_settings') ?? '{}')).toEqual({ forceVisionMode: false });
  });

  it('cleans the actual subscription once at app quit and cancels delayed retry', async () => {
    runtime = useKnowledgeBase();
    expect(runtime.getPollingStatus().isActive).toBe(true);
    quit(); quit();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(runtime.getPollingStatus().isActive).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
