/**
 * @file RejectionTracker.ts
 * @description 轻量级拒绝反馈追踪服务
 *
 * 功能：
 * - 记录最近被拒绝的自动补全建议（最多2条）
 * - 记录用户拒绝后继续输入的文本
 * - 自动过期清理（2分钟）
 * - 提供给 AI 以避免重复建议
 */

import type { RejectedSuggestion, RejectionForApi } from '../types';
import { AUTOCOMPLETE_CONFIG } from '../types';

const { maxSize, expiryMs, maxSuggestionLength, maxUserContinuedLength } = AUTOCOMPLETE_CONFIG.rejection;

/**
 * 拒绝反馈追踪器
 * 使用固定大小队列，自动淘汰最旧的记录
 */
class RejectionTracker {
  private queue: RejectedSuggestion[] = [];

  /**
   * 添加一条拒绝记录
   * @param suggestion 被拒绝的建议文本
   * @param suggestionPos 建议显示的位置
   * @param userContinued 用户拒绝后继续输入的文本（可选）
   */
  addRejection(suggestion: string, suggestionPos: number, userContinued?: string): void {
    // 清理过期记录
    this.cleanExpired();

    // 添加新记录
    this.queue.push({
      suggestionText: suggestion.slice(0, maxSuggestionLength),
      suggestionPos,
      rejectedAt: Date.now(),
      userContinuedWith: userContinued?.slice(0, maxUserContinuedLength),
    });

    // 保持队列大小
    while (this.queue.length > maxSize) {
      this.queue.shift();
    }
  }

  /**
   * 更新最近一条拒绝记录的用户继续输入文本
   * @param userContinued 用户继续输入的文本
   */
  updateLastRejectionWithUserInput(userContinued: string): void {
    if (this.queue.length > 0) {
      const lastRejection = this.queue[this.queue.length - 1];
      // 只在过期时间内有效
      if (Date.now() - lastRejection.rejectedAt < expiryMs) {
        lastRejection.userContinuedWith = userContinued.slice(0, maxUserContinuedLength);
      }
    }
  }

  /**
   * 获取最近的拒绝记录列表
   * @returns 拒绝记录数组（已过滤过期记录）
   */
  getRecentRejections(): RejectedSuggestion[] {
    this.cleanExpired();
    return [...this.queue];
  }

  /**
   * 获取用于 API 请求的拒绝反馈数据
   * @returns 格式化的拒绝反馈数组
   */
  getRejectionsForApi(): RejectionForApi[] {
    return this.getRecentRejections().map(r => ({
      suggestionText: r.suggestionText,
      userContinuedWith: r.userContinuedWith,
    }));
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 检查是否有有效的拒绝记录
   */
  hasRejections(): boolean {
    this.cleanExpired();
    return this.queue.length > 0;
  }

  /**
   * 清理过期记录
   */
  private cleanExpired(): void {
    const now = Date.now();
    this.queue = this.queue.filter(r => now - r.rejectedAt < expiryMs);
  }
}

// 导出单例实例
export const rejectionTracker = new RejectionTracker();

export default rejectionTracker;

// 重新导出类型，方便外部使用
export type { RejectedSuggestion, RejectionForApi };
