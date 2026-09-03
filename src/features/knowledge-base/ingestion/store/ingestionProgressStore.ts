/**
 * @file src/features/knowledge-base/ingestion/store/ingestionProgressStore.ts
 * 
 * @brief 摄取进度读模型 - 连接状态机与前端轮询的桥梁
 * 
 * @description
 * 功能 (What): 提供全局单例的摄取进度读模型，连接后台 Worker 和前端轮询
 * 输入 (Input): 摄取进度快照更新操作
 * 输出 (Output): 摄取进度查询结果和状态变化事件
 * 副作用 (Side-effects): 内存状态更新、事件发射
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('IngestionProgressStore');
const TERMINAL_SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 前端轮询需要的摄取进度快照。
 */
export interface IngestionProgressSnapshot {
  doc_id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'duplicate';
  message: string;
  error?: string;
  updated_at: number;
  // 🔥 新增：统一进度字段（用于轮询与前端校准）
  progress?: number;        // 0-100 的绝对进度
  stage?: string;           // '', 'parsing', 'embedding', 'storing', 'completed'
  stage_progress?: number;  // 0-100 的阶段内进度
}

/**
 * 状态变化事件类型
 */
export interface IngestionProgressEvents {
  'state-updated': (docId: string, newState: IngestionProgressSnapshot) => void;
  'state-deleted': (docId: string) => void;
  'ingestion-completed': (docId: string, finalState: IngestionProgressSnapshot) => void;
  'ingestion-failed': (docId: string, finalState: IngestionProgressSnapshot) => void;
}

/**
 * 功能 (What): 全局任务状态存储类
 * 输入 (Input): 各种状态操作请求
 * 输出 (Output): 状态数据和事件通知  
 * 副作用 (Side-effects): 管理内存状态、发射事件
 */
export class IngestionProgressStore extends EventEmitter {
  private states: Map<string, IngestionProgressSnapshot> = new Map();
  private static instance: IngestionProgressStore | null = null;
  private lastCleanupCheckAt = 0;

  private constructor() {
    super();
    logger.info('[IngestionProgressStore] 初始化摄取进度存储');
  }

  /**
   * 功能 (What): 获取全局单例实例
   * 输入 (Input): 无
   * 输出 (Output): IngestionProgressStore 实例
   * 副作用 (Side-effects): 首次调用时创建实例
   */
  public static getInstance(): IngestionProgressStore {
    if (!IngestionProgressStore.instance) {
      IngestionProgressStore.instance = new IngestionProgressStore();
    }
    return IngestionProgressStore.instance;
  }

  /**
   * 功能 (What): 设置或更新任务状态
   * 输入 (Input): 文档 ID 和新的摄取进度快照
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新内存状态、发射状态变化事件
   */
  public setState(docId: string, newState: IngestionProgressSnapshot): void {
    if (!docId || !newState) {
      logger.error('[IngestionProgressStore] 无效的进度更新请求', `docId: ${docId}, state: ${JSON.stringify(newState)}`);
      return;
    }

    const now = Date.now();
    if (now - this.lastCleanupCheckAt >= CLEANUP_CHECK_INTERVAL_MS) {
      // 清理随真实写入机会性执行，避免模块求值时启动无 owner 的永久定时器。
      this.cleanupExpiredSnapshots(TERMINAL_SNAPSHOT_RETENTION_MS);
      this.lastCleanupCheckAt = now;
    }

    const previousState = this.states.get(docId);

    // 🔒 单调钳制：进度不得倒退
    let mergedProgress = newState.progress;
    if (previousState && typeof previousState.progress === 'number') {
      if (typeof mergedProgress === 'number') {
        mergedProgress = Math.max(previousState.progress, mergedProgress);
      } else {
        mergedProgress = previousState.progress;
      }
    }

    const mergedState: IngestionProgressSnapshot = {
      ...(previousState || {}),
      ...newState,
      progress: mergedProgress,
      // 统一更新时间（毫秒）
      updated_at: Date.now()
    };

    this.states.set(docId, mergedState);

    // 发射状态更新事件
    this.emit('state-updated', docId, mergedState);

    // 如果状态发生了实质性变化，记录日志
    if (!previousState || previousState.status !== newState.status) {
      logger.info(`[IngestionProgressStore] 状态更新: ${docId} - ${previousState ? previousState.status : 'new'} -> ${newState.status} (${newState.message})`);
    }

    // 发射终态事件
    if (mergedState.status === 'completed') {
      this.emit('ingestion-completed', docId, mergedState);
    } else if (mergedState.status === 'failed') {
      this.emit('ingestion-failed', docId, mergedState);
    }
  }

  /**
   * 功能 (What): 获取指定任务的状态
   * 输入 (Input): 文档ID
   * 输出 (Output): 摄取进度快照或 null
   * 副作用 (Side-effects): 无
   */
  public getState(docId: string): IngestionProgressSnapshot | null {
    return this.states.get(docId) || null;
  }

  /**
   * 功能 (What): 批量获取多个任务的状态
   * 输入 (Input): 文档ID数组
   * 输出 (Output): 按文档 ID 索引的摄取进度快照
   * 副作用 (Side-effects): 无
   */
  public getBatchStates(docIds: string[]): Record<string, IngestionProgressSnapshot> {
    const result: Record<string, IngestionProgressSnapshot> = {};
    
    for (const docId of docIds) {
      const state = this.states.get(docId);
      if (state) {
        result[docId] = state;
      }
    }

    return result;
  }

  /**
   * 功能 (What): 删除指定任务的状态
   * 输入 (Input): 文档ID
   * 输出 (Output): 是否删除成功
   * 副作用 (Side-effects): 从内存中移除状态、发射删除事件
   */
  public deleteState(docId: string): boolean {
    if (this.states.has(docId)) {
      this.states.delete(docId);
      this.emit('state-deleted', docId);
      logger.info(`[IngestionProgressStore] 删除摄取进度: ${docId}`);
      return true;
    }
    return false;
  }

  /**
   * 功能 (What): 获取所有活跃任务的数量
   * 输入 (Input): 无
   * 输出 (Output): 活跃任务数量
   * 副作用 (Side-effects): 无
   */
  public getActiveIngestionCount(): number {
    let activeCount = 0;
    for (const state of this.states.values()) {
      if (state.status === 'pending' || state.status === 'processing') {
        activeCount++;
      }
    }
    return activeCount;
  }

  /**
   * 功能 (What): 清理过期的已完成任务
   * 输入 (Input): 过期时间（毫秒）
   * 输出 (Output): 清理的任务数量
   * 副作用 (Side-effects): 删除过期状态
   */
  public cleanupExpiredSnapshots(maxAge: number = TERMINAL_SNAPSHOT_RETENTION_MS): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [docId, state] of this.states.entries()) {
      if ((state.status === 'completed' || state.status === 'failed' || state.status === 'duplicate') &&
          (now - state.updated_at) > maxAge) {
        this.states.delete(docId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[IngestionProgressStore] 清理过期进度: ${cleanedCount} 个`);
    }

    return cleanedCount;
  }

  /**
   * 功能 (What): 获取存储统计信息（用于调试）
   * 输入 (Input): 无
   * 输出 (Output): 统计信息对象
   * 副作用 (Side-effects): 无
   */
  public getStats(): { total: number; byStatus: Record<string, number> } {
    const stats = {
      total: this.states.size,
      byStatus: {} as Record<string, number>
    };

    for (const state of this.states.values()) {
      stats.byStatus[state.status] = (stats.byStatus[state.status] || 0) + 1;
    }

    return stats;
  }
}

// 导出全局单例实例
export const ingestionProgressStore = IngestionProgressStore.getInstance();

/**
 * 功能 (What): 便捷的状态更新函数
 * 输入 (Input): 文档 ID 和摄取进度快照
 * 输出 (Output): 无
 * 副作用 (Side-effects): 调用全局存储的setState方法
 */
export function updateIngestionProgress(docId: string, state: IngestionProgressSnapshot): void {
  ingestionProgressStore.setState(docId, state);
}

/**
 * 功能 (What): 便捷的状态查询函数
 * 输入 (Input): 文档ID
 * 输出 (Output): 摄取进度快照或 null
 * 副作用 (Side-effects): 无
 */
export function getIngestionProgress(docId: string): IngestionProgressSnapshot | null {
  return ingestionProgressStore.getState(docId);
}

/**
 * 功能 (What): 便捷的批量状态查询函数
 * 输入 (Input): 文档ID数组
 * 输出 (Output): 按文档 ID 索引的摄取进度快照
 * 副作用 (Side-effects): 无
 */
export function getBatchIngestionProgress(docIds: string[]): Record<string, IngestionProgressSnapshot> {
  return ingestionProgressStore.getBatchStates(docIds);
}

/**
 * 功能 (What): 创建摄取进度快照
 * 输入 (Input): 基本状态信息
 * 输出 (Output): 摄取进度快照
 * 副作用 (Side-effects): 无
 */
export function createIngestionProgressSnapshot(
  docId: string,
  filename: string,
  status: IngestionProgressSnapshot['status'],
  message: string,
  error?: string
): IngestionProgressSnapshot {
  return {
    doc_id: docId,
    filename,
    status,
    message,
    error,
    updated_at: Date.now(),
    // 进度与阶段字段可选，由上层按需补充
  };
}
