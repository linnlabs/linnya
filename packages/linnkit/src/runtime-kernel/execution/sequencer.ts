/**
 * @file src/agent/runtime-kernel/execution/sequencer.ts
 * @description 事件序列器 - 为事件分配序号和执行上下文
 * 
 * 功能 (What):
 * - 为每个执行流程生成唯一的 execution_id
 * - 为事件分配单调递增的序号 (seq)
 * - 将 RuntimeEvent 包装为 EventEnvelope，提供追踪和渲染元数据
 * 
 * 输入 (Input):
 * - RuntimeEvent 或原始事件数据
 * - source 信息（事件来源）
 * 
 * 输出 (Output):
 * - EventEnvelope 包装的事件
 * 
 * 副作用 (Side-effects):
 * - 维护内存中的序号状态
 */

import { generateExecutionId, generateTraceId } from '../../contracts';
import { Logger } from '../../shared/logger';
import type { EventEnvelope, ExecutionTraceContext, RuntimeEvent } from '../../contracts';

const logger = new Logger('EventSequencer');

/**
 * 事件序列器类
 * 
 * 职责：
 * - 管理执行上下文（execution_id, trace_id）
 * - 为事件分配严格递增的序号
 * - 提供事件包装功能
 */
export class EventSequencer {
  private readonly executionId: string;
  private readonly traceId: string;
  private currentSeq = 0;

  constructor(
    conversationId: string,
    traceId?: string
  ) {
    // 🔥 修复：使用标准化的 ID 生成函数，保持代码一致性
    this.executionId = generateExecutionId();
    this.traceId = traceId || generateTraceId();
    
    logger.info(`EventSequencer created for conversation ${conversationId}`, {
      executionId: this.executionId,
      traceId: this.traceId,
    });
  }

  /**
   * 获取执行上下文
   */
  getExecutionContext(): ExecutionTraceContext {
    return {
      execution_id: this.executionId,
      trace_id: this.traceId,
    };
  }

  /**
   * 获取下一个序号
   * 这个方法是线程安全的，因为 Node.js 是单线程的
   */
  private getNextSeq(): number {
    return ++this.currentSeq;
  }

  /**
   * 将 RuntimeEvent 包装为 EventEnvelope
   * 
   * @param runtimeEvent - 需要包装的运行时事件
   * @param source - 事件来源标识
   * @param renderHint - 可选的渲染建议
   * @param runLocation - 可选的执行位置
   * @returns 包装后的事件信封
   */
  wrapEvent<TEvent extends RuntimeEvent>(
    runtimeEvent: TEvent,
    source: string,
    options: {
      renderHint?: EventEnvelope<RuntimeEvent>['render_hint'];
      runLocation?: EventEnvelope<RuntimeEvent>['run_location'];
    } = {}
  ): EventEnvelope<TEvent> {
    const envelope: EventEnvelope<TEvent> = {
      seq: this.getNextSeq(),
      timestamp: Date.now(),
      trace: this.getExecutionContext(),
      source,
      payload: runtimeEvent,
      render_hint: options.renderHint,
      run_location: options.runLocation,
    };

    return envelope;
  }

  /**
   * 获取当前序号（调试用）
   */
  getCurrentSeq(): number {
    return this.currentSeq;
  }

  /**
   * 获取执行ID（调试用）
   */
  getExecutionId(): string {
    return this.executionId;
  }
}
