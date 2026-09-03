/**
 * @file src/app-hosts/linnya/agent-registry/registry.ts
 * @description AgentRegistry：统一管理“可调用 agent（promptKey）”的定义与扩展点注册
 *
 * 当前阶段目标（最小可用）：
 * - 提供一个集中式注册表：声明每个 promptKey 需要的 HistoryBuilderExtender / RequestEnricher
 * - Flow 主链路只需调用一次 ensureBuiltinAgentIntegrationsRegistered()
 *
 * 后续演进方向（不在本次改动范围）：
 * - 把工具策略（enableTools/availableTools/knowledgeBaseId）也收口到这里并替代 createAgentOptions
 * - 支持“内部调用”：通过 agentId 一键构造 AgentInvokeRequest（避免各处手动拼字段）
 * - 支持 PersonaRegistry：统一管理 Review 等场景的 LLM 角色（内置/DB/远程配置）
 */

import type { AgentDefinition, AgentRegistryDependencies } from './types';
import { historyBuilderOptionsExtenderRegistry } from 'src/app-hosts/linnya/adapters/flow/history-builder/history-builder-options-extender.registry';
import { enrichment } from '@linnlabs/linnkit/runtime-kernel';

class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();

  register(def: AgentDefinition): void {
    if (this.definitions.has(def.id)) {
      // 允许重复注册同 id：保持幂等，避免热加载/多入口 import 导致重复写入
      return;
    }
    this.definitions.set(def.id, def);
  }

  get(id: string): AgentDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * 注册所有 HistoryBuilderOptionsExtender
   *
   * 注意：
   * - 去重职责由 historyBuilderOptionsExtenderRegistry 自己承担（按 name 去重）
   */
  registerHistoryBuilderExtenders(): void {
    for (const def of this.definitions.values()) {
      const integrations = def.integrations;
      if (!integrations) continue;

      const extenderFactories = integrations.historyBuilderExtenders ?? [];
      for (const createExtender of extenderFactories) {
        historyBuilderOptionsExtenderRegistry.register(createExtender());
      }
    }
  }

  /**
   * 注册所有 RequestEnricher（需要依赖）
   *
   * 注意：
   * - 去重职责由 requestEnricherRegistry 自己承担（按 name 去重）
   * - 不做兜底：依赖缺失应直接抛错暴露根因
   */
  registerRequestEnrichers(deps: AgentRegistryDependencies): void {
    for (const def of this.definitions.values()) {
      const integrations = def.integrations;
      if (!integrations) continue;

      const enricherFactories = integrations.requestEnrichers ?? [];
      for (const createEnricher of enricherFactories) {
        enrichment.requestEnricherRegistry.register(createEnricher(deps));
      }
    }
  }
}

export const agentRegistry = new AgentRegistry();
