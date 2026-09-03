import { describe, expect, it, afterEach } from 'vitest';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import {
  ensureToolContextRuntimeCapability,
  getToolContextRuntimeBinding,
} from '@linnlabs/linnkit/runtime-kernel';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

import type { ToolContext } from 'src/tools/types';
import { backendPluginRegistry } from '../registry';
import { ensureBuiltinBackendPluginsRegistered } from '../builtin';
import {
  clearToolContextBindingMigratorCacheForTests,
  derivePluginAwareToolContext,
} from '../toolContextDerivation';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../pluginRuntimeState';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  attachCitationSequence,
  attachCitationRefAllocator,
  attachCitationSourceResolver,
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
  requireCitationSourceResolver,
} from '../../../../domains/citation';

function createRuntimeEvent(id: string): RuntimeEvent {
  return {
    type: 'user_input',
    id,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    timestamp: 1,
    version: 1,
    content: id,
    source: 'user',
  };
}

describe('derivePluginAwareToolContext', () => {
  afterEach(() => {
    clearPluginRuntimeStateForTests();
    clearToolContextBindingMigratorCacheForTests();
  });

  it('通过 contribution migrator 迁移插件 WeakMap 私有绑定', () => {
    ensureBuiltinBackendPluginsRegistered();
    const pluginId = `weakmap-binding-${crypto.randomUUID()}`;
    const bindings = new WeakMap<object, object>();
    backendPluginRegistry.register({
      meta: {
        id: pluginId,
        name: pluginId,
        version: '1.0.0',
        description: 'WeakMap binding migration fixture',
        developer: 'Linnya',
        builtin: false,
      },
      toolContextBindingMigrators: [{
        migrate: (source, target) => {
          const binding = bindings.get(source);
          if (binding) bindings.set(target, binding);
        },
      }],
    });
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform', pluginId],
    });
    const source = createToolContextFixture({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }) as ToolContext;
    const binding = {};
    bindings.set(source, binding);

    const derived = derivePluginAwareToolContext(source, {
      runId: RunIdSchema.parse('run-derived'),
    });

    expect(derived).not.toBe(source);
    expect(derived.runId).toBe('run-derived');
    expect(bindings.get(derived)).toBe(binding);
  });

  it('迁移 linnkit runtime 隐藏绑定，并让 execution meta 写入派生 context', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
    const persisted = [createRuntimeEvent('persisted-1')];
    const working = [createRuntimeEvent('working-1')];
    const source = createToolContextFixture({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }) as ToolContext;
    ensureToolContextRuntimeCapability({
      context: source,
      persistedHistory: persisted,
      workingHistory: working,
      executionMeta: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        runId: RunIdSchema.parse('run-source'),
      },
    });

    const derived = derivePluginAwareToolContext(source, {
      runId: RunIdSchema.parse('run-derived'),
    });
    const derivedBinding = getToolContextRuntimeBinding(derived);

    expect(derivedBinding).toBeTruthy();
    expect(derivedBinding).not.toBe(getToolContextRuntimeBinding(source));
    expect(derived.conversationView?.getPersistedHistoryEvents()).toBe(persisted);
    expect(derived.conversationView?.getWorkingHistoryEvents()).toBe(working);

    derivedBinding?.bindExecutionMeta({ runId: RunIdSchema.parse('run-updated') });

    expect(derived.runId).toBe('run-updated');
    expect(source.runId).toBe('run-source');
  });

  it('迁移 Citation sequence、ref allocator 与 source resolver 私有绑定', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
    const source = createToolContextFixture({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }) as ToolContext;
    const resolver = { resolveSources: async () => [] };
    const allocator = { allocate: async () => [] };
    attachCitationSequence(source, { offset: 7 });
    attachCitationRefAllocator(source, allocator);
    attachCitationSourceResolver(source, resolver);

    const derived = derivePluginAwareToolContext(source, {
      runId: RunIdSchema.parse('run-derived'),
    });

    expect(requireCitationSequenceOffset(derived)).toBe(7);
    expect(requireCitationRefAllocator(derived)).toBe(allocator);
    expect(requireCitationSourceResolver(derived)).toBe(resolver);
  });

  it('拒绝从未经 runtime admission 的 ToolContext 派生执行上下文', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });

    expect(() =>
      derivePluginAwareToolContext({}, { runId: RunIdSchema.parse('run-invalid') })
    ).toThrow('before runtime capability admission');
  });

  it('按 registry revision 和启用插件集合缓存 migrator 列表，但每次派生仍执行迁移', () => {
    const pluginId = `tool-context-cache-${crypto.randomUUID()}`;
    const migrateCalls: string[] = [];
    backendPluginRegistry.register({
      meta: {
        id: pluginId,
        name: pluginId,
        version: '1.0.0',
        description: 'ToolContext derivation cache test plugin',
        developer: 'Linnya',
        builtin: true,
      },
      toolContextBindingMigrators: [
        {
          migrate: () => migrateCalls.push(pluginId),
        },
      ],
    });
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform', pluginId],
    });

    const source = createToolContextFixture({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }) as ToolContext;

    derivePluginAwareToolContext(source, { runId: RunIdSchema.parse('run-1') });
    derivePluginAwareToolContext(source, { runId: RunIdSchema.parse('run-2') });

    expect(migrateCalls).toEqual([pluginId, pluginId]);
  });
});
