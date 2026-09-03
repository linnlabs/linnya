/**
 * 插件 registry 响应式查询 composable。
 *
 * registry 内部使用普通 Map 存储文档类型、工具卡等注册信息。
 * Vue 的响应式追踪无法感知普通 Map 的读写，因此在 computed 中直接调用
 * registry 的纯函数查询（如 resolveDocumentTypeByNodeType）时，
 * 后续注册变更不会触发 computed 重算。
 *
 * 本模块为每个常用查询提供 composable 封装：
 * - 内部自动订阅 rendererPluginRegistryRevision（registry 每次写入都会 bump）
 * - 内部自动读取 enabledPluginsStore 的 reactive 状态
 * - 返回 ComputedRef，消费方无需关心底层响应式桥接
 *
 * Vue 组件中的 computed **必须使用这些 composable**，禁止直接调用 registry 纯函数。
 * 纯函数仍保留给测试、命令式事件处理等非响应式场景。
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { useEnabledPluginsStore } from './enabledPluginsStore';
import {
  useRendererPluginRegistryRevision,
  resolveDocumentTypeByNodeType,
  resolveDocumentTypeByActiveType,
  getDocumentTypeByNodeType,
  listDocumentTypes,
  listCreatableDocumentTypesForLoadedRuntimeState,
  getDocumentActionMenuByActiveType,
  getDocumentRuntimeLoaderByActiveType,
  listToolCards,
  listConversationAgentChoices,
  getConversationAgentChoiceById,
} from './registry';
import type {
  DocumentNodeTypeAvailability,
  DocumentTypeAvailability,
} from './registry';
import type {
  DocumentTypeContribution,
  DocumentActionMenuContribution,
  DocumentRuntimeLoaderContribution,
  ConversationAgentChoiceContribution,
} from './types';
import type { ToolUiEntry } from '@linnya/plugin-host-contract/renderer/toolUi';

export function useDocumentTypeAvailabilityByNodeType(
  nodeType: MaybeRefOrGetter<string>,
): ComputedRef<DocumentNodeTypeAvailability> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    return resolveDocumentTypeByNodeType(
      toValue(nodeType),
      store.enabledPluginIds,
      store.states,
    );
  });
}

export function useDocumentTypeAvailabilityByActiveType(
  activeType: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<DocumentTypeAvailability | null> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    const type = toValue(activeType);
    return type ? resolveDocumentTypeByActiveType(type, store.enabledPluginIds) : null;
  });
}

export function useDocumentTypeByNodeType(
  nodeType: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<DocumentTypeContribution | null> {
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    const type = toValue(nodeType);
    return type ? getDocumentTypeByNodeType(type) : null;
  });
}

export function useDocumentTypes(): ComputedRef<readonly DocumentTypeContribution[]> {
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    return listDocumentTypes();
  });
}

export function useCreatableDocumentTypes(): ComputedRef<readonly DocumentTypeContribution[]> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    return listCreatableDocumentTypesForLoadedRuntimeState({
      hasLoaded: store.hasLoaded,
      enabledPluginIds: store.enabledPluginIds,
    });
  });
}

export function useDocumentActionMenu(
  activeType: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<DocumentActionMenuContribution | null> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    const type = toValue(activeType);
    return type ? getDocumentActionMenuByActiveType(type, store.enabledPluginIds) : null;
  });
}

export function useDocumentRuntimeLoader(
  activeType: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<DocumentRuntimeLoaderContribution | null> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    const type = toValue(activeType);
    return type ? getDocumentRuntimeLoaderByActiveType(type, store.enabledPluginIds) : null;
  });
}

export function useToolCards(): ComputedRef<Readonly<Record<string, ToolUiEntry>>> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    return listToolCards(store.enabledPluginIds);
  });
}

export function useConversationAgentChoices(): ComputedRef<readonly ConversationAgentChoiceContribution[]> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    return listConversationAgentChoices(store.enabledPluginIds);
  });
}

export function useConversationAgentChoiceById(
  agentChoiceId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<ConversationAgentChoiceContribution | null> {
  const store = useEnabledPluginsStore();
  const revision = useRendererPluginRegistryRevision();
  return computed(() => {
    revision.value;
    const id = toValue(agentChoiceId);
    return id ? getConversationAgentChoiceById(id, store.enabledPluginIds) : null;
  });
}
