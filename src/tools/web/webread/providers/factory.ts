import { Logger } from '@shared/logger';
import {
  WebReadConfigurationError,
  type WebReadConfig,
  type WebReadCredentialReaderId,
} from '../definitions/webReadConfig';
import {
  WEB_READ_SERVICE_DEFINITIONS,
  type WebReadServiceRequest,
} from '../definitions/webReadService';
import { JinaReaderProvider } from './jina';
import { LocalHttpProvider } from './localHttp';
import { LocalRenderProvider } from './localRender';
import { MetasoReaderProvider } from './metaso';
import type { WebReadProvider } from './types';

const logger = new Logger('WebReadProviderFactory');

export interface WebReadProviderFactoryDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** 本地 HTTP 是读取阶梯的固定首跳，不依赖 Model Catalog 或外部凭证。 */
export function createLocalWebReadProvider(): WebReadProvider {
  return new LocalHttpProvider();
}

/** 本地 Chromium 是读取阶梯的按需第二跳，通过 port 使用 Electron 主进程实现。 */
export function createLocalRenderWebReadProvider(): WebReadProvider {
  return new LocalRenderProvider();
}

function resolveCredential(
  selection: WebReadConfig,
  reader: WebReadCredentialReaderId,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return selection.byokKey?.trim()
    || environment[WEB_READ_SERVICE_DEFINITIONS[reader].environmentVariable]?.trim();
}

export function hasWebReadFallbackCredential(
  reader: WebReadCredentialReaderId,
  dependencies: WebReadProviderFactoryDependencies = {},
): boolean {
  const environment = dependencies.environment ?? process.env;
  return Boolean(
    environment[WEB_READ_SERVICE_DEFINITIONS[reader].environmentVariable]?.trim(),
  );
}

/**
 * 按本次读取捕获的显式配置创建唯一托管 Reader，不按 Registry 顺序 fallback。
 * 调用方只应在读取阶梯真正进入托管分支时调用本函数。
 */
export function createWebReadProvider(
  selection: WebReadConfig,
  dependencies: WebReadProviderFactoryDependencies = {},
): WebReadProvider {
  if (selection.managedReader === 'none') {
    throw new WebReadConfigurationError('managed_disabled', '未启用第三方网页解析。');
  }
  const environment = dependencies.environment ?? process.env;
  const definition = WEB_READ_SERVICE_DEFINITIONS[selection.managedReader];
  const apiKey = resolveCredential(selection, selection.managedReader, environment);
  if (!apiKey) {
    throw new WebReadConfigurationError(
      'missing_credentials',
      `${selection.managedReader === 'metaso_reader' ? '秘塔' : 'Jina'}网页解析 API Key 未配置。请在“网络搜索”设置中填写 Key。`,
    );
  }
  const selectedConfig: WebReadServiceRequest = {
    serviceId: definition.id,
    baseUrl: definition.baseUrl,
    apiKey,
  };
  logger.info('[createWebReadProvider] 选择 provider', {
    operation: 'read',
    provider: selection.managedReader,
    credentialSource: selection.byokKey ? 'stored_byok' : 'environment',
  });
  return createWebReadProviderFromConfig(selectedConfig);
}

export function createWebReadProviderFromConfig(config: WebReadServiceRequest): WebReadProvider {
  switch (config.serviceId) {
    case 'metaso_reader':
      return new MetasoReaderProvider(config);
    case 'jina_reader':
      return new JinaReaderProvider(config);
    default:
      throw new WebReadConfigurationError(
        'invalid_config',
        `不支持的 Web Read serviceId: "${config.serviceId}"。`,
      );
  }
}
