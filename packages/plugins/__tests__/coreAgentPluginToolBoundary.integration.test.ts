import { describe, expect, it } from 'vitest';
import { platformBackendPlugin } from 'src/app-hosts/linnya/plugin-registry/builtin/platform.backend';
import { slidesBackendPlugin } from '@plugin/slides/backend';
import knowledgeBackendPlugin from '../knowledge/src/backend';
import { backendPlugin as decisionBackendPlugin } from '../decision/src/backend';
import { backendPlugin as canvasBackendPlugin } from '../canvas/src/backend';

/**
 * 产品不变式（docs/product-model-overview.md §3.1、§6）：插件工具只挂在插件自己的 Agent 上，
 * Core Agent 使用插件能力走 CLI + Skill。否则每接入一个插件，所有 Agent 的工具都会变多。
 *
 * Knowledge 是插件化之前留下的唯一历史例外：这四个工具仍写在 Core Agent 清单里。
 * 这份名单只能缩小（Core 改为读取插件声明后删掉），不能为新插件或新工具扩大。
 */
const KNOWLEDGE_HISTORICAL_EXCEPTION = [
  'knowledge_read',
  'knowledge_search',
  'list_knowledge_base',
  'search_in_knowledgebase',
] as const;

const OFFICIAL_PLUGINS = [
  knowledgeBackendPlugin,
  slidesBackendPlugin,
  decisionBackendPlugin,
  canvasBackendPlugin,
];

function pluginToolOwners(): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const plugin of OFFICIAL_PLUGINS) {
    for (const ToolClass of plugin.toolClasses ?? []) {
      owners.set(new ToolClass().name, plugin.meta.id);
    }
  }
  return owners;
}

describe('Core Agent 与插件工具的边界', () => {
  it('Core Agent 只用到 Knowledge 历史例外里的插件工具', () => {
    const owners = pluginToolOwners();
    const pluginToolsInCoreAgents = new Map<string, string[]>();
    for (const agent of platformBackendPlugin.agentDefinitions ?? []) {
      for (const tool of agent.config?.availableTools ?? []) {
        const owner = owners.get(tool);
        if (!owner) continue;
        pluginToolsInCoreAgents.set(`${owner}:${tool}`, [
          ...(pluginToolsInCoreAgents.get(`${owner}:${tool}`) ?? []),
          agent.id,
        ]);
      }
    }

    const allowed = new Set(KNOWLEDGE_HISTORICAL_EXCEPTION.map(tool => `${knowledgeBackendPlugin.meta.id}:${tool}`));
    const violations = [...pluginToolsInCoreAgents.entries()]
      .filter(([key]) => !allowed.has(key))
      .map(([key, agents]) => `${key} ← ${agents.join(', ')}`);
    expect(violations).toEqual([]);
    // 例外名单里的工具必须真由 Knowledge 提供；改名或删除后要同步收窄名单，不留空名额给别的工具。
    for (const tool of KNOWLEDGE_HISTORICAL_EXCEPTION) {
      expect(owners.get(tool)).toBe(knowledgeBackendPlugin.meta.id);
    }
  });
});
