import {
  describeRendererPluginRegistryForDiagnostics,
  type DocumentNodeTypeAvailability,
} from './registry';
import type { useEnabledPluginsStore } from './enabledPluginsStore';
import { getRuntimeRendererPluginLoaderDiagnostics } from './loader/runtimeRendererPluginLoader';

type EnabledPluginsStore = ReturnType<typeof useEnabledPluginsStore>;

interface UnavailableDocumentNodeDiagnostics {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  projectId?: string | null;
  inode?: string | null;
}

interface LogUnavailableDocumentTypeDiagnosticsOptions {
  source: string;
  documentId: string;
  nodeType: string;
  availability: DocumentNodeTypeAvailability;
  enabledPluginsStore: EnabledPluginsStore;
  node?: UnavailableDocumentNodeDiagnostics | null;
}

const diagnosticsLastLoggedAt = new Map<string, number>();

function getAvailabilityPluginId(availability: DocumentNodeTypeAvailability): string | null {
  if ('pluginId' in availability) return availability.pluginId;
  if ('documentType' in availability) return availability.documentType.pluginId;
  return null;
}

function buildLogKey(options: LogUnavailableDocumentTypeDiagnosticsOptions): string {
  const pluginId = getAvailabilityPluginId(options.availability);
  return [
    options.source,
    options.documentId,
    options.nodeType,
    options.availability.state,
    pluginId ?? 'none',
  ].join(':');
}

export function logUnavailableDocumentTypeDiagnostics(
  options: LogUnavailableDocumentTypeDiagnosticsOptions,
): void {
  const logKey = buildLogKey(options);
  const now = Date.now();
  const lastLoggedAt = diagnosticsLastLoggedAt.get(logKey) ?? 0;
  if (now - lastLoggedAt < 5000) return;
  diagnosticsLastLoggedAt.set(logKey, now);

  const pluginId = getAvailabilityPluginId(options.availability);
  const loader = getRuntimeRendererPluginLoaderDiagnostics();
  const matchingEntry = pluginId
    ? loader.entries.find((entry) => entry.pluginId === pluginId) ?? null
    : null;
  const matchingFailure = pluginId
    ? loader.sync?.failures.find((failure) => failure.entry.pluginId === pluginId) ?? null
    : null;

  console.error(`[${options.source}] document-type-unavailable-diagnostics`, {
    documentId: options.documentId,
    nodeType: options.nodeType,
    node: options.node ?? null,
    availability: options.availability,
    pluginId,
    enabledPlugins: {
      hasLoaded: options.enabledPluginsStore.hasLoaded,
      enabledPluginIds: Array.from(options.enabledPluginsStore.enabledPluginIds ?? []),
      states: options.enabledPluginsStore.states,
      error: options.enabledPluginsStore.error,
      diagnostics: options.enabledPluginsStore.diagnostics,
    },
    rendererRegistry: describeRendererPluginRegistryForDiagnostics(),
    rendererLoader: {
      ...loader,
      matchingEntry,
      matchingFailure,
    },
  });
}
