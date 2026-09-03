/**
 * @file src/agent/context-manager/profiles/agent/context/providers/working-memory/ReplacementSourceTagger.ts
 * @description 替换源标记器 - 负责管理消息的替换源ID追踪
 *
 * 🎯 职责:
 * - 为工具组标记替换源ID
 * - 添加替换源ID到消息状态
 *
 * 🔥 核心作用:
 * - 确保在摘要化时能够正确追溯被替换的原始消息ID
 * - 实现精确的历史净化机制
 */

import type { MessageProcessingState } from '../base';

/**
 * 替换源标记器
 *
 * 负责管理消息的替换源ID追踪，确保摘要化时能够正确追溯被替换的原始消息
 */
export class ReplacementSourceTagger {
  /**
   * 为工具组标记替换源
   *
   * 只收集当前工具组中真实被替代的消息 ID，
   * 严禁再向相邻的 user_input / final_answer 扩散，避免后续摘要把无关消息吞掉。
   */
  tagReplacementSources(
    pair: MessageProcessingState[],
    _statePool: MessageProcessingState[]
  ): void {
    const ids = Array.from(new Set(pair.map(state => state.message.id).filter(Boolean)));
    if (ids.length === 0) {
      return;
    }

    // 为工具对中的每个消息添加替换源ID
    pair.forEach(state => this.addReplacementSources(state, ids));
  }

  /**
   * 添加替换源ID到消息状态
   *
   * 将新的ID合并到现有的 replacementSourceIds 列表中，自动去重
   */
  addReplacementSources(state: MessageProcessingState, ids: string[]): void {
    const existing = state.replacementSourceIds ?? [];
    const merged = new Set<string>([...existing, ...ids]);
    state.replacementSourceIds = Array.from(merged);
  }

  /**
   * 查找相邻状态
   *
   * 从指定索引开始，按指定方向查找满足条件的第一个状态
   *
   * @param stateMap 索引到状态的映射
   * @param startIndex 起始索引
   * @param direction 查找方向：-1 向前，1 向后
   * @param predicate 匹配条件
   */
  findAdjacentState(
    stateMap: Map<number, MessageProcessingState>,
    startIndex: number,
    direction: -1 | 1,
    predicate: (state: MessageProcessingState) => boolean
  ): MessageProcessingState | null {
    const indices = Array.from(stateMap.keys());
    if (indices.length === 0) {
      return null;
    }
    const minIndex = Math.min(...indices);
    const maxIndex = Math.max(...indices);

    for (let index = startIndex + direction; index >= minIndex && index <= maxIndex; index += direction) {
      const candidate = stateMap.get(index);
      if (candidate && predicate(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}
