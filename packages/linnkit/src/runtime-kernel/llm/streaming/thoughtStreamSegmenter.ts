/**
 * @file src/agent/runtime-kernel/llm/streaming/thoughtStreamSegmenter.ts
 * @description
 * thought 流式段落管理（交错 thought 支持 + 精确计时）。
 *
 * 设计目标：
 * - 高内聚：只负责 thought 的“段落切分、缓冲、开始/结束锚点”；
 * - 低耦合：不直接发事件，由上层（LlmCaller）决定如何映射为 AnyAgentEvent。
 */

import { generateThoughtMessageId } from '../../../contracts';
import { normalizeThoughtDeltaForMarkdown } from './markdownHeadingNormalizer';

export type ThoughtDeltaEmission = {
  thoughtMessageId: string;
  timestamp: number;
  delta: string;
  thoughtStartedAt: number;
};

export type ThoughtCompleteEmission = {
  thoughtMessageId: string;
  timestamp: number;
  content: string;
  thoughtStartedAt: number;
  thoughtCompletedAt: number;
};

export class ThoughtStreamSegmenter {
  private currentThoughtMessageId: string | null = null;
  private currentThoughtBuffer = '';
  private thoughtStartedAt: number | null = null;
  private lastThoughtDeltaAt: number | null = null;
  private inAnswerPhase = false;

  private now(): number {
    return Date.now();
  }

  private beginIfNeeded(now: number): void {
    if (this.currentThoughtMessageId) return;
    this.currentThoughtMessageId = generateThoughtMessageId();
    this.currentThoughtBuffer = '';
    this.thoughtStartedAt = now;
    this.lastThoughtDeltaAt = now;
  }

  /**
   * @description
   * 当出现“答案内容 / 工具调用”等边界时调用：封口当前 thought 段落。
   * 注意：结束锚点取最后一次 thought delta 的时间（而不是下一个消息时间）。
   */
  onBoundary(): ThoughtCompleteEmission | null {
    if (!this.currentThoughtMessageId) {
      this.inAnswerPhase = true;
      return null;
    }
    this.inAnswerPhase = true;
    return this.finalizeIfNeeded();
  }

  onThoughtDelta(rawDelta: string): ThoughtDeltaEmission | null {
    const thought = String(rawDelta ?? '');
    if (!thought.trim()) return null;

    const now = this.now();

    // 交错 thought：如果已经进入答案阶段，则开启新段
    if (this.inAnswerPhase) {
      this.inAnswerPhase = false;
    }

    this.beginIfNeeded(now);
    this.lastThoughtDeltaAt = now;

    // 标题行修正：基于展示缓冲拼接
    const normalized = normalizeThoughtDeltaForMarkdown(this.currentThoughtBuffer, thought);
    this.currentThoughtBuffer += normalized;
    const thoughtMessageId = this.currentThoughtMessageId;
    if (!thoughtMessageId) {
      throw new Error('ThoughtStreamSegmenter must admit a thought identity before emitting a delta.');
    }

    return {
      thoughtMessageId,
      timestamp: now,
      delta: normalized,
      thoughtStartedAt: this.thoughtStartedAt ?? now,
    };
  }

  finalize(): ThoughtCompleteEmission | null {
    return this.finalizeIfNeeded();
  }

  private finalizeIfNeeded(): ThoughtCompleteEmission | null {
    if (!this.currentThoughtMessageId) return null;
    if (!this.currentThoughtBuffer.trim()) {
      this.reset();
      return null;
    }

    const startedAt = this.thoughtStartedAt ?? this.lastThoughtDeltaAt ?? this.now();
    const completedAt = this.lastThoughtDeltaAt ?? this.now();
    const thoughtMessageId = this.currentThoughtMessageId;
    const content = this.currentThoughtBuffer;

    this.reset();
    return {
      thoughtMessageId,
      timestamp: completedAt,
      content,
      thoughtStartedAt: startedAt,
      thoughtCompletedAt: completedAt,
    };
  }

  private reset(): void {
    this.currentThoughtMessageId = null;
    this.currentThoughtBuffer = '';
    this.thoughtStartedAt = null;
    this.lastThoughtDeltaAt = null;
  }
}
