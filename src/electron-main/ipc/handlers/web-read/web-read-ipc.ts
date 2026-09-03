import {
  FileWebReadConfigStore,
  type WebReadCredentialCodec,
} from '../../../../infra/adapters/web-read-config/fileWebReadConfigStore';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import { Logger } from '../../../../shared/logger';
import { pathManager } from '../../../../shared/utils/pathManager';
import {
  WebReadConfigurationError,
  type WebReadConfig,
  type WebReadConfigView,
  type WebReadCredentialReaderId,
  type WebReadSettings,
} from '../../../../tools/web/webread/definitions/webReadConfig';
import { toWebReadConfigView } from '../../../../tools/web/webread/functions/normalizeWebReadConfig';
import { installWebReadConfigReader } from '../../../../tools/web/webread/ports/webReadConfigReader';
import {
  createWebReadProvider,
  hasWebReadFallbackCredential,
  type WebReadProviderFactoryDependencies,
} from '../../../../tools/web/webread/providers/factory';
import type { WebReadProvider } from '../../../../tools/web/webread/providers/types';

const logger = new Logger('WebReadConfigIPC');
const CONNECTION_TEST_URL = 'https://example.com/';
const CONNECTION_TEST_MAX_CHARS = 1_000;
const CREDENTIAL_READER_IDS: readonly WebReadCredentialReaderId[] = [
  'metaso_reader',
  'jina_reader',
];

interface WebReadConfigStore {
  read(): WebReadConfig;
  readSettings(): WebReadSettings;
  preview(input: unknown): WebReadConfig;
  save(input: unknown): WebReadSettings | Promise<WebReadSettings>;
}

interface RegisterWebReadConfigHandlersOptions {
  readonly store?: WebReadConfigStore;
  readonly createProvider?: (
    selection: WebReadConfig,
    dependencies?: WebReadProviderFactoryDependencies,
  ) => WebReadProvider;
  readonly hasFallbackCredential?: (reader: WebReadCredentialReaderId) => boolean;
  readonly credentialProtection?: WebReadCredentialCodec;
}

async function createDefaultStore(
  credentialProtection: WebReadCredentialCodec | undefined,
): Promise<FileWebReadConfigStore> {
  if (!credentialProtection) {
    throw new Error('Web Read 配置缺少 Desktop credential protection port');
  }
  return FileWebReadConfigStore.open(
    pathManager.getWebReadConfigPath(),
    credentialProtection,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createConfigView(
  settings: WebReadSettings,
  hasFallbackCredential: (reader: WebReadCredentialReaderId) => boolean,
): WebReadConfigView {
  const availability: Partial<Record<WebReadCredentialReaderId, boolean>> = {};
  for (const reader of CREDENTIAL_READER_IDS) {
    availability[reader] = hasFallbackCredential(reader);
  }
  return toWebReadConfigView(settings, availability);
}

export async function registerWebReadConfigHandlers(
  ipc: BackendRendererIpcStyleRegistrarPort,
  options: RegisterWebReadConfigHandlersOptions = {},
): Promise<void> {
  const store = options.store ?? await createDefaultStore(options.credentialProtection);
  const providerFactory = options.createProvider ?? createWebReadProvider;
  const fallbackCredentialAvailable = options.hasFallbackCredential
    ?? hasWebReadFallbackCredential;
  installWebReadConfigReader(store);

  ipc.handle('web-read-config:get', async () => {
    try {
      return {
        success: true,
        data: createConfigView(store.readSettings(), fallbackCredentialAvailable),
      };
    } catch (error: unknown) {
      logger.error('[web-read-config:get] 读取失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipc.handle('web-read-config:set', async (_event, input: unknown) => {
    try {
      return {
        success: true,
        data: createConfigView(await store.save(input), fallbackCredentialAvailable),
      };
    } catch (error: unknown) {
      logger.error('[web-read-config:set] 保存失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  ipc.handle('web-read-config:test-connection', async (_event, input: unknown) => {
    try {
      const config = store.preview(input);
      if (config.managedReader === 'none') {
        throw new WebReadConfigurationError('managed_disabled', '仅使用本机解析时无需测试第三方连接。');
      }
      const provider = providerFactory(config);
      const startedAt = Date.now();
      const result = await provider.read({
        url: CONNECTION_TEST_URL,
        maxChars: CONNECTION_TEST_MAX_CHARS,
      });
      if (result.content.trim().length === 0) {
        throw new Error('网页读取服务已响应，但没有返回可用正文。');
      }
      return {
        success: true,
        data: {
          provider: provider.name,
          charCount: result.charCount,
          tookMs: Date.now() - startedAt,
        },
      };
    } catch (error: unknown) {
      logger.error('[web-read-config:test-connection] 测试失败', error);
      return { success: false, error: errorMessage(error) };
    }
  });

  logger.info('网络读取配置 IPC handlers 已注册');
}
