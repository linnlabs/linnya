import {
  FileWebSearchConfigStore,
  type WebSearchCredentialCodec,
} from '../../../../infra/adapters/web-search-config/fileWebSearchConfigStore';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import { pathManager } from '../../../../shared/utils/pathManager';
import { Logger } from '../../../../shared/logger';
import { toWebSearchConfigView } from '../../../../tools/web/websearch/functions/normalizeWebSearchConfig';
import { installWebSearchConfigReader } from '../../../../tools/web/websearch/ports/webSearchConfigReader';
import {
  createWebSearchProvider,
  type WebSearchProviderFactoryDependencies,
} from '../../../../tools/web/websearch/providers/factory';
import type {
  WebSearchConfig,
  WebSearchSettings,
} from '../../../../tools/web/websearch/definitions/webSearchConfig';
import type { WebSearchProvider } from '../../../../tools/web/websearch/providers/types';

const logger = new Logger('WebSearchConfigIPC');

interface WebSearchConfigStore {
  read(): WebSearchConfig;
  readSettings(): WebSearchSettings;
  preview(input: unknown): WebSearchConfig;
  save(input: unknown): WebSearchSettings | Promise<WebSearchSettings>;
}

interface RegisterWebSearchConfigHandlersOptions {
  readonly store?: WebSearchConfigStore;
  readonly createProvider?: (
    selection: WebSearchConfig,
    dependencies?: WebSearchProviderFactoryDependencies,
  ) => WebSearchProvider;
  readonly credentialProtection?: WebSearchCredentialCodec;
}

async function createDefaultStore(
  credentialProtection: WebSearchCredentialCodec | undefined,
): Promise<FileWebSearchConfigStore> {
  if (!credentialProtection) {
    throw new Error('Web Search 配置缺少 Desktop credential protection port');
  }
  return FileWebSearchConfigStore.open(
    pathManager.getWebSearchConfigPath(),
    credentialProtection,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function registerWebSearchConfigHandlers(
  ipc: BackendRendererIpcStyleRegistrarPort,
  options: RegisterWebSearchConfigHandlersOptions = {},
): Promise<void> {
  const store = options.store ?? await createDefaultStore(options.credentialProtection);
  const providerFactory = options.createProvider ?? createWebSearchProvider;
  installWebSearchConfigReader(store);

  ipc.handle('web-search-config:get', async () => {
    try {
      return { success: true, data: toWebSearchConfigView(store.readSettings()) };
    } catch (error: unknown) {
      logger.error('[web-search-config:get] 读取失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipc.handle('web-search-config:set', async (_event, input: unknown) => {
    try {
      return { success: true, data: toWebSearchConfigView(await store.save(input)) };
    } catch (error: unknown) {
      logger.error('[web-search-config:set] 保存失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipc.handle('web-search-config:test-connection', async (_event, input: unknown) => {
    try {
      const config = store.preview(input);
      const provider = providerFactory(config);
      const startedAt = Date.now();
      const results = await provider.search({ query: 'Linnya AI', topK: 1 });
      if (results.length === 0) {
        throw new Error('搜索服务已响应，但没有返回可用结果。');
      }
      return {
        success: true,
        data: {
          provider: provider.name,
          resultCount: results.length,
          tookMs: Date.now() - startedAt,
        },
      };
    } catch (error: unknown) {
      logger.error('[web-search-config:test-connection] 测试失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  logger.info('Web Search 配置 IPC handlers 已注册');
}
