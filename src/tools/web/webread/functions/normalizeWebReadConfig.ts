import {
  WEB_READ_MANAGED_READER_IDS,
  WebReadConfigurationError,
  type WebReadConfig,
  type WebReadConfigView,
  type WebReadCredentialReaderId,
  type WebReadManagedReaderId,
  type WebReadSettings,
} from '../definitions/webReadConfig';

const CREDENTIAL_READER_IDS: readonly WebReadCredentialReaderId[] = [
  'metaso_reader',
  'jina_reader',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function isWebReadManagedReaderId(value: unknown): value is WebReadManagedReaderId {
  return typeof value === 'string'
    && WEB_READ_MANAGED_READER_IDS.some((candidate) => candidate === value);
}

export function normalizeWebReadConfig(value: unknown): WebReadConfig {
  if (!isRecord(value)
    || typeof value.renderEnabled !== 'boolean'
    || !isWebReadManagedReaderId(value.managedReader)
    || value.keySource !== undefined) {
    throw new WebReadConfigurationError(
      'invalid_config',
      '网络读取配置缺少有效的 renderEnabled 或 managedReader。',
    );
  }
  if (value.managedReader === 'none') {
    return {
      renderEnabled: value.renderEnabled,
      managedReader: value.managedReader,
    };
  }
  const byokKey = readOptionalString(value.byokKey);
  return {
    renderEnabled: value.renderEnabled,
    managedReader: value.managedReader,
    ...(byokKey ? { byokKey } : {}),
  };
}

export function normalizeWebReadSettings(value: unknown): WebReadSettings {
  if (!isRecord(value)
    || typeof value.renderEnabled !== 'boolean'
    || !isWebReadManagedReaderId(value.managedReader)
    || !isRecord(value.slots)) {
    throw new WebReadConfigurationError('invalid_config', '网络读取设置结构无效。');
  }
  const slots: WebReadSettings['slots'] = {};
  for (const reader of CREDENTIAL_READER_IDS) {
    const rawSlot = value.slots[reader];
    if (rawSlot === undefined) continue;
    if (!isRecord(rawSlot)) {
      throw new WebReadConfigurationError(
        'invalid_config',
        `网络读取 ${reader} 凭证槽格式无效。`,
      );
    }
    const byokKey = readOptionalString(rawSlot.byokKey);
    slots[reader] = { ...(byokKey ? { byokKey } : {}) };
  }
  return {
    renderEnabled: value.renderEnabled,
    managedReader: value.managedReader,
    slots,
  };
}

export function toWebReadConfigView(
  settings: WebReadSettings,
  fallbackCredentialAvailability: Readonly<Partial<Record<WebReadCredentialReaderId, boolean>>> = {},
): WebReadConfigView {
  const metasoStored = typeof settings.slots.metaso_reader?.byokKey === 'string';
  const jinaStored = typeof settings.slots.jina_reader?.byokKey === 'string';
  return {
    renderEnabled: settings.renderEnabled,
    managedReader: settings.managedReader,
    readers: {
      metaso_reader: {
        hasStoredByokKey: metasoStored,
        credentialAvailable: metasoStored || fallbackCredentialAvailability.metaso_reader === true,
      },
      jina_reader: {
        hasStoredByokKey: jinaStored,
        credentialAvailable: jinaStored || fallbackCredentialAvailability.jina_reader === true,
      },
    },
  };
}
