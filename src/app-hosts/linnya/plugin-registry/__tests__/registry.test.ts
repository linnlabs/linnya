import { describe, expect, it } from 'vitest';

import { backendPluginRegistry } from '../registry';
import {
  getDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
} from '@plugin/backend/documentTypeBackendHook';
import type { PluginBackendContribution } from '../types';
import type { PluginId } from '@app/schemas';

function makeHook(docType: string): DocumentTypeBackendHook {
  return {
    docType,
    displayName: docType,
  };
}

// 中文说明：构造一个只贡献单个 agentDefinition 的最小插件，用于校验 promptKey 全局唯一性。
function makeAgentContribution(pluginId: string, promptKey: string): PluginBackendContribution {
  return {
    meta: {
      id: pluginId,
      name: pluginId,
      version: '1.0.0',
      description: `${pluginId} test plugin`,
      developer: 'Linnya',
      builtin: false,
      dependsOn: [],
    },
    agentDefinitions: [
      {
        id: promptKey,
        promptKey,
        defaultMode: 'agent',
        description: `${pluginId} agent`,
      },
    ],
  };
}

function makeContribution(
  pluginId: string,
  hooks: readonly DocumentTypeBackendHook[]
): PluginBackendContribution {
  return {
    meta: {
      id: pluginId,
      name: pluginId,
      version: '1.0.0',
      description: `${pluginId} test plugin`,
      developer: 'Linnya',
      builtin: false,
      dependsOn: [],
    },
    documentTypeHooks: hooks,
  };
}

describe('backendPluginRegistry registration consistency', () => {
  it('rolls back document type hooks when contribution registration fails', () => {
    const existingDocType = `registry-existing-${crypto.randomUUID()}`;
    const rolledBackDocType = `registry-rolled-back-${crypto.randomUUID()}`;
    const existingContribution = makeContribution(
      `registry-existing-plugin-${crypto.randomUUID()}`,
      [makeHook(existingDocType)]
    );
    const partialContribution = makeContribution(`registry-partial-plugin-${crypto.randomUUID()}`, [
      makeHook(rolledBackDocType),
      makeHook(existingDocType),
    ]);

    backendPluginRegistry.register(existingContribution);

    expect(() => backendPluginRegistry.register(partialContribution)).toThrow(
      `[doc-type-hook] 重复注册文档类型 hook: ${existingDocType}`
    );

    expect(backendPluginRegistry.has(partialContribution.meta.id)).toBe(false);
    expect(
      getDocumentTypeBackendHook(rolledBackDocType, { includeDisabled: true })
    ).toBeUndefined();
    expect(getDocumentTypeBackendHook(existingDocType, { includeDisabled: true })).toBe(
      existingContribution.documentTypeHooks?.[0]
    );
  });

  it('拒绝非 builtin 插件贡献宿主内 command 能力', () => {
    const contribution: PluginBackendContribution = {
      ...makeContribution(`registry-external-command-${crypto.randomUUID()}`, []),
      pluginCli: {
        prepare: () => ({
          status: 'completed',
          result: { exitCode: 0, stdout: '', stderr: '' },
        }),
      },
    };

    expect(() => backendPluginRegistry.register(contribution)).toThrow(
      'Plugin CLI bridge 只允许来自 Host 可信装配源的插件贡献'
    );
    expect(backendPluginRegistry.has(contribution.meta.id)).toBe(false);
  });

  it('不信任磁盘 contribution 自己声明的 builtin 身份', () => {
    const pluginId = `registry-forged-builtin-command-${crypto.randomUUID()}`;
    const base = makeContribution(pluginId, []);
    const contribution: PluginBackendContribution = {
      ...base,
      meta: { ...base.meta, builtin: true },
      pluginCli: {
        prepare: () => ({
          status: 'completed',
          result: { exitCode: 0, stdout: '', stderr: '' },
        }),
      },
    };

    expect(() => backendPluginRegistry.register(contribution)).toThrow(
      'Plugin CLI bridge 只允许来自 Host 可信装配源的插件贡献'
    );
    expect(backendPluginRegistry.has(pluginId)).toBe(false);
  });
});

describe('backendPluginRegistry agent promptKey uniqueness', () => {
  it('throws when two enabled plugins register the same agent promptKey', () => {
    const promptKey = `dup-prompt-${crypto.randomUUID()}`;
    const first = makeAgentContribution(`reg-agent-a-${crypto.randomUUID()}`, promptKey);
    const second = makeAgentContribution(`reg-agent-b-${crypto.randomUUID()}`, promptKey);

    backendPluginRegistry.register(first);
    backendPluginRegistry.register(second);

    const enabled = new Set<PluginId>([first.meta.id, second.meta.id]);
    expect(() => backendPluginRegistry.getAgentDefinitions(enabled)).toThrow(
      `[plugin-registry] agent promptKey 冲突: ${promptKey}`
    );
  });

  it('aggregates agent definitions when promptKeys are unique', () => {
    const first = makeAgentContribution(
      `reg-agent-uniq-a-${crypto.randomUUID()}`,
      `prompt-a-${crypto.randomUUID()}`
    );
    const second = makeAgentContribution(
      `reg-agent-uniq-b-${crypto.randomUUID()}`,
      `prompt-b-${crypto.randomUUID()}`
    );

    backendPluginRegistry.register(first);
    backendPluginRegistry.register(second);

    const enabled = new Set<PluginId>([first.meta.id, second.meta.id]);
    const result = backendPluginRegistry.getAgentDefinitions(enabled);

    expect(result.map(definition => definition.promptKey)).toEqual([
      first.agentDefinitions?.[0].promptKey,
      second.agentDefinitions?.[0].promptKey,
    ]);
  });
});
