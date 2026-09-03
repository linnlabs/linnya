/**
 * @file history-builder-options-extender.registry.ts
 * @description HistoryBuilder options 扩展器注册表
 *
 * 设计：
 * - 注册是幂等的：同名 extender 不重复注册
 * - 应用时按注册顺序合并字段（后注册的同名字段会覆盖先前值）
 *
 * 目的：
 * - 避免 HistoryBuilder 变成“全业务参数路由器”
 * - 让每个 Feature 在自己的目录里维护“我需要透传哪些 options 字段”
 */

import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type {
  HistoryBuilderOptionsExtender,
  HistoryBuilderOptionsExtenderContext,
} from './history-builder-options-extender.types';

export class HistoryBuilderOptionsExtenderRegistry {
  private readonly extenders: HistoryBuilderOptionsExtender[] = [];
  private readonly nameSet = new Set<string>();

  register(extender: HistoryBuilderOptionsExtender): void {
    if (this.nameSet.has(extender.name)) {
      return;
    }
    this.nameSet.add(extender.name);
    this.extenders.push(extender);
  }

  apply(
    base: AgentInvokeRequest,
    ctx: HistoryBuilderOptionsExtenderContext
  ): AgentInvokeRequest {
    let merged: AgentInvokeRequest = base;

    for (const extender of this.extenders) {
      if (!extender.isApplicable(ctx)) continue;
      const patch = extender.extend(ctx);
      merged = { ...merged, ...patch };
    }

    return merged;
  }
}

export const historyBuilderOptionsExtenderRegistry = new HistoryBuilderOptionsExtenderRegistry();
