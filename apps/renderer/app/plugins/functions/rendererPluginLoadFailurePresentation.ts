import type {
  RendererPluginSyncFailureReason,
  RuntimeRendererPluginLoaderDiagnostics,
} from '../loader/runtimeRendererPluginLoader';
import type { RendererPluginLoadMessageResolver } from '../definitions/rendererPluginLoadMessages';

export interface RendererPluginLoadFailureSummary {
  /** 产生这份失败结果的同步编号；用户关闭提示按编号记忆，新一轮失败会再次提示。 */
  readonly runId: number;
  readonly failures: readonly {
    readonly pluginId: string;
    readonly reason: RendererPluginSyncFailureReason;
  }[];
}

/**
 * 把 loader 的终态诊断投影成用户提示需要的最小事实。running 快照不改变结论，
 * 由调用方保留上一份终态；成功返回 null。
 */
export function summarizeRendererPluginLoadFailures(
  diagnostics: RuntimeRendererPluginLoaderDiagnostics,
): RendererPluginLoadFailureSummary | null {
  if (diagnostics.status !== 'failed') return null;
  const failures = diagnostics.sync?.failures ?? [];
  if (diagnostics.sync && failures.length === 0) return null;
  return {
    runId: diagnostics.runId,
    failures: failures.map((failure) => ({
      pluginId: failure.entry.pluginId,
      reason: failure.reason,
    })),
  };
}

export function buildRendererPluginLoadFailureMessage(
  summary: RendererPluginLoadFailureSummary,
  options: {
    readonly message: RendererPluginLoadMessageResolver;
    readonly resolvePluginName: (pluginId: string) => string;
  },
): string {
  const pluginNames = Array.from(new Set(summary.failures.map((failure) => failure.pluginId)))
    .map(options.resolvePluginName);
  if (pluginNames.length === 0) {
    return options.message('plugins.runtimeLoad.failed.generic');
  }
  if (pluginNames.length === 1) {
    return options.message('plugins.runtimeLoad.failed.single', { pluginName: pluginNames[0] ?? '' });
  }
  return options.message('plugins.runtimeLoad.failed.multiple', {
    count: pluginNames.length,
    pluginNames: pluginNames.join(options.message('plugins.runtimeLoad.pluginNameSeparator')),
  });
}
