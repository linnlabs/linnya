import { computed, onScopeDispose, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import { useLocalization } from '@app/localization';
import { RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS } from '../definitions/rendererPluginLoadMessageCatalog';
import type { RendererPluginLoadMessageResolver } from '../definitions/rendererPluginLoadMessages';
import { useEnabledPluginsStore } from '../enabledPluginsStore';
import {
  buildRendererPluginLoadFailureMessage,
  summarizeRendererPluginLoadFailures,
  type RendererPluginLoadFailureSummary,
} from '../functions/rendererPluginLoadFailurePresentation';
import {
  getRuntimeRendererPluginLoaderDiagnostics,
  subscribeRuntimeRendererPluginLoaderDiagnostics,
} from '../loader/runtimeRendererPluginLoader';

export interface RendererPluginLoadFailureNoticeState {
  readonly visible: ComputedRef<boolean>;
  readonly message: ComputedRef<string>;
  readonly retrying: Ref<boolean>;
  readonly pluginLoadMessage: RendererPluginLoadMessageResolver;
  retry(): Promise<void>;
  dismiss(): void;
}

/**
 * 把 loader 最近一次终态投影成可关闭、可重试的提示。重试由调用方注入完整的
 * 插件运行时同步流程，这里不直接操作 registry。
 */
export function useRendererPluginLoadFailureNotice(
  retryLoad: () => Promise<void>,
): RendererPluginLoadFailureNoticeState {
  const { message } = useLocalization();
  const enabledPluginsStore = useEnabledPluginsStore();
  const pluginLoadMessage: RendererPluginLoadMessageResolver = (key, params) =>
    message(key, RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS[key], params);

  const summary = shallowRef<RendererPluginLoadFailureSummary | null>(
    summarizeRendererPluginLoadFailures(getRuntimeRendererPluginLoaderDiagnostics()),
  );
  const dismissedRunId = ref<number | null>(null);
  const retrying = ref(false);

  const unsubscribe = subscribeRuntimeRendererPluginLoaderDiagnostics((diagnostics) => {
    if (diagnostics.status === 'running' || diagnostics.status === 'idle') return;
    summary.value = summarizeRendererPluginLoadFailures(diagnostics);
  });
  onScopeDispose(unsubscribe);

  const visible = computed(() => summary.value !== null && summary.value.runId !== dismissedRunId.value);
  const noticeMessage = computed(() => {
    const current = summary.value;
    if (!current) return '';
    return buildRendererPluginLoadFailureMessage(current, {
      message: pluginLoadMessage,
      resolvePluginName: (pluginId) => enabledPluginsStore.states
        .find((state) => state.meta.id === pluginId)?.meta.name ?? pluginId,
    });
  });

  async function retry(): Promise<void> {
    if (retrying.value) return;
    retrying.value = true;
    try {
      await retryLoad();
    } catch (error) {
      console.error('[renderer-plugin-loader] retry-failed', error);
    } finally {
      retrying.value = false;
    }
  }

  function dismiss(): void {
    dismissedRunId.value = summary.value?.runId ?? null;
  }

  return {
    visible,
    message: noticeMessage,
    retrying,
    pluginLoadMessage,
    retry,
    dismiss,
  };
}
