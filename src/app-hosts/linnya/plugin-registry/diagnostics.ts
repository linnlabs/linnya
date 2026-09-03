import type { PluginDiagnosticView } from '@app/schemas';

class PluginDiagnosticsCollector {
  private entries: PluginDiagnosticView[] = [];

  record(entry: Omit<PluginDiagnosticView, 'at'>): void {
    const diagnostic = { ...entry, at: Date.now() };
    this.entries.push(diagnostic);

    // 中文说明：插件注册问题必须可观察，后续设置页也会读取同一份诊断列表。
    const tag = `[plugin-diagnostics][${entry.level}]`;
    const text = `${tag} ${entry.pluginId ?? '-'}/${entry.capability ?? '-'}: ${entry.message}`;
    if (entry.level === 'error') {
      console.error(text);
    } else if (entry.level === 'warn') {
      console.warn(text);
    } else {
      console.log(text);
    }
  }

  list(): readonly PluginDiagnosticView[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}

export const pluginDiagnostics = new PluginDiagnosticsCollector();
