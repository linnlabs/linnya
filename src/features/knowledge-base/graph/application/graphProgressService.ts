/**
 * @file graphProgressService.ts
 *
 * @description
 * 软知识图谱进度聚合服务（Milestone 4）。
 *
 * 设计目标：
 * - 以 SQLite（knowledge_graph_doc_status）为权威来源计算 KB 级进度；
 * - 对频繁的 chunk 级更新做节流，避免过度刷库/过度推送；
 * - 不依赖 Electron/IPC：由上层注入回调实现推送（高内聚低耦合）。
 */
import type { KnowledgeGraphKbProgress, KnowledgeGraphRepository } from '../infrastructure/knowledgeGraphRepository';

export type KbGraphProgressPayload = {
  kbId: string;
  /**
   * 0~100 的百分比（四舍五入到整数）。
   */
  percent: number;
  totalUnits: number;
  doneUnits: number;
  updatedAtSeconds: number | null;
};

export type GraphProgressServiceOptions = {
  /**
   * 推送节流间隔（毫秒）。默认 250ms。
   */
  throttleMs?: number;
  /**
   * 当进度刷新完成时回调（例如通过 IPC 推送给渲染进程）。
   */
  onProgressUpdated?: (payload: KbGraphProgressPayload) => void;
};

/**
 * 图谱进度聚合服务
 */
export class GraphProgressService {
  private readonly repo: KnowledgeGraphRepository;
  private readonly throttleMs: number;
  private readonly onProgressUpdated?: (payload: KbGraphProgressPayload) => void;

  /**
   * 每个 kb 的节流状态：只要在 throttle 窗口内收到多次触发，就合并为一次刷新。
   */
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastEmitAtMs = new Map<string, number>();

  constructor(repo: KnowledgeGraphRepository, options: GraphProgressServiceOptions = {}) {
    this.repo = repo;
    this.throttleMs = typeof options.throttleMs === 'number' && options.throttleMs > 0 ? options.throttleMs : 250;
    this.onProgressUpdated = options.onProgressUpdated;
  }

  /**
   * 文档入队时写入 queued 状态（用于“新增文档导致进度回落”的分母扩张）。
   *
   * 注意：worker 会在真正开始时把状态置为 running，并重置 done_chunks=0；
   * 这里的写入是为了“尽早让 chunk_count 进入分母”，不与 worker 的语义冲突。
   */
  async onDocQueued(kbId: string, docId: string, chunkCount: number): Promise<void> {
    // 根因修复：为支持“失败后只重跑未完成 chunk”，queued 写入不能把 doneChunks 覆盖为 0
    // 否则会破坏 worker 的断点续跑（doneChunks 变成 0 -> 又整篇重跑）。
    const existing = await this.repo.getDocStatus(kbId, docId);
    const preservedDoneChunks =
      existing && existing.chunkCount === chunkCount && existing.doneChunks > 0 ? existing.doneChunks : 0;
    await this.repo.upsertDocStatus({
      kbId,
      docId,
      chunkCount,
      doneChunks: preservedDoneChunks,
      status: 'queued',
    });
    this.requestRefresh(kbId);
  }

  /**
   * 文档进度变化（running/completed/failed/cancelled）时触发刷新。
   *
   * 说明：doc_status 的写入由 worker 负责；这里仅做聚合与推送节流。
   */
  onDocProgress(kbId: string): void {
    this.requestRefresh(kbId);
  }

  /**
   * 供 IPC handler 同步读取。
   */
  async getKbProgress(kbId: string): Promise<KbGraphProgressPayload> {
    const progress = await this.repo.getKbProgress(kbId);
    return GraphProgressService.toPayload(progress);
  }

  private requestRefresh(kbId: string): void {
    const existing = this.pendingTimers.get(kbId);
    if (existing) return;

    const timer = setTimeout(() => {
      this.pendingTimers.delete(kbId);
      void this.refreshNow(kbId);
    }, this.throttleMs);
    this.pendingTimers.set(kbId, timer);
  }

  private async refreshNow(kbId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastEmitAtMs.get(kbId) ?? 0;
    if (now - last < this.throttleMs) {
      // 仍在节流窗口内：合并为下一次
      this.requestRefresh(kbId);
      return;
    }

    const progress = await this.repo.getKbProgress(kbId);
    const payload = GraphProgressService.toPayload(progress);
    this.lastEmitAtMs.set(kbId, now);
    this.onProgressUpdated?.(payload);
  }

  private static toPayload(progress: KnowledgeGraphKbProgress): KbGraphProgressPayload {
    const ratio = typeof progress.progress === 'number' ? progress.progress : 0;
    const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    return {
      kbId: progress.kbId,
      percent,
      totalUnits: progress.totalUnits,
      doneUnits: progress.doneUnits,
      updatedAtSeconds: progress.updatedAtSeconds,
    };
  }
}


