import {
  WEB_READ_MANAGED_READER_IDS,
  type WebReadConfig,
  type WebReadConfigView,
  type WebReadCredentialReaderId,
  type WebReadManagedReaderId,
} from '../../../../src/tools/web/webread/definitions/webReadConfig';

const CREDENTIAL_READER_IDS: readonly WebReadCredentialReaderId[] = [
  'metaso_reader',
  'jina_reader',
];

export interface WebReadConnectionTestResult {
  readonly provider: string;
  readonly charCount: number;
  readonly tookMs: number;
}

export type WebReadConfigGatewayResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFailure(value: Record<string, unknown>): WebReadConfigGatewayResult<never> | undefined {
  return value.success === false && typeof value.error === 'string'
    ? { success: false, error: value.error }
    : undefined;
}

function isManagedReader(value: unknown): value is WebReadManagedReaderId {
  return typeof value === 'string'
    && WEB_READ_MANAGED_READER_IDS.some((reader) => reader === value);
}

function parseConfigResult(value: unknown): WebReadConfigGatewayResult<WebReadConfigView> {
  if (!isRecord(value)) return { success: false, error: '主进程返回了无效的网络读取配置响应。' };
  const failure = parseFailure(value);
  if (failure) return failure;
  const data = value.data;
  if (value.success !== true
    || !isRecord(data)
    || typeof data.renderEnabled !== 'boolean'
    || !isManagedReader(data.managedReader)
    || !isRecord(data.readers)) {
    return { success: false, error: '主进程返回了无效的网络读取配置响应。' };
  }
  const readers: WebReadConfigView['readers'] = {
    metaso_reader: { hasStoredByokKey: false, credentialAvailable: false },
    jina_reader: { hasStoredByokKey: false, credentialAvailable: false },
  };
  for (const reader of CREDENTIAL_READER_IDS) {
    const rawReader = data.readers[reader];
    if (!isRecord(rawReader)
      || typeof rawReader.hasStoredByokKey !== 'boolean'
      || typeof rawReader.credentialAvailable !== 'boolean') {
      return { success: false, error: '主进程返回了无效的网络读取配置响应。' };
    }
    readers[reader] = {
      hasStoredByokKey: rawReader.hasStoredByokKey,
      credentialAvailable: rawReader.credentialAvailable,
    };
  }
  return {
    success: true,
    data: {
      renderEnabled: data.renderEnabled,
      managedReader: data.managedReader,
      readers,
    },
  };
}

function parseConnectionResult(value: unknown): WebReadConfigGatewayResult<WebReadConnectionTestResult> {
  if (!isRecord(value)) return { success: false, error: '主进程返回了无效的连接测试响应。' };
  const failure = parseFailure(value);
  if (failure) return failure;
  const data = value.data;
  if (value.success !== true
    || !isRecord(data)
    || typeof data.provider !== 'string'
    || typeof data.charCount !== 'number'
    || typeof data.tookMs !== 'number') {
    return { success: false, error: '主进程返回了无效的连接测试响应。' };
  }
  return {
    success: true,
    data: { provider: data.provider, charCount: data.charCount, tookMs: data.tookMs },
  };
}

async function invoke(channel: string, data?: unknown): Promise<unknown> {
  const result = window.electronAPI?.invoke(channel, data);
  if (!result) throw new Error('Electron IPC 当前不可用。');
  return result;
}

export const webReadConfigGateway = {
  async get(): Promise<WebReadConfigGatewayResult<WebReadConfigView>> {
    return parseConfigResult(await invoke('web-read-config:get'));
  },
  async set(config: WebReadConfig): Promise<WebReadConfigGatewayResult<WebReadConfigView>> {
    return parseConfigResult(await invoke('web-read-config:set', config));
  },
  async testConnection(
    config: WebReadConfig,
  ): Promise<WebReadConfigGatewayResult<WebReadConnectionTestResult>> {
    return parseConnectionResult(await invoke('web-read-config:test-connection', config));
  },
};
