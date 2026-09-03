export const WEB_READ_MANAGED_READER_IDS = [
  'metaso_reader',
  'jina_reader',
  'none',
] as const;

export type WebReadManagedReaderId = (typeof WEB_READ_MANAGED_READER_IDS)[number];
export type WebReadCredentialReaderId = Exclude<WebReadManagedReaderId, 'none'>;

/** 单次读取捕获的生效配置快照；工厂与缓存身份必须共享同一份。 */
export interface WebReadConfig {
  readonly renderEnabled: boolean;
  readonly managedReader: WebReadManagedReaderId;
  readonly byokKey?: string;
}

/** 单个托管 Reader 的持久化凭证槽。 */
export interface WebReadCredentialSlot {
  readonly byokKey?: string;
}

/** Web 读取配置的域内权威结构。 */
export interface WebReadSettings {
  readonly renderEnabled: boolean;
  readonly managedReader: WebReadManagedReaderId;
  readonly slots: Partial<Record<WebReadCredentialReaderId, WebReadCredentialSlot>>;
}

export interface WebReadReaderConfigView {
  readonly hasStoredByokKey: boolean;
  /** 包含已保存 Key 或该 Reader 自己声明的环境变量凭证，不泄露明文。 */
  readonly credentialAvailable: boolean;
}

export interface WebReadConfigView {
  readonly renderEnabled: boolean;
  readonly managedReader: WebReadManagedReaderId;
  readonly readers: Record<WebReadCredentialReaderId, WebReadReaderConfigView>;
}

export const DEFAULT_WEB_READ_CONFIG: WebReadConfig = Object.freeze({
  renderEnabled: true,
  managedReader: 'none',
});

export const DEFAULT_WEB_READ_SETTINGS: WebReadSettings = Object.freeze({
  renderEnabled: true,
  managedReader: 'none',
  slots: Object.freeze({}),
});

export type WebReadConfigurationErrorCode =
  | 'invalid_config'
  | 'missing_credentials'
  | 'managed_disabled';

export class WebReadConfigurationError extends Error {
  readonly name = 'WebReadConfigurationError';

  constructor(
    readonly code: WebReadConfigurationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
