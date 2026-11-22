import type {
  PluginCatalogChannel,
  PluginCatalogRevocation,
  PluginRuntimeEntry,
  SignedPluginCatalogEntry,
} from '@app/schemas';

/**
 * 官方插件 catalog 的 Host 侧合同：发布方用独立插件密钥签名，Desktop 只信任内置公钥。
 * 与 Desktop 发行清单同为“原始 payload bytes + Ed25519 签名”的信封，但密钥与吊销互不牵连。
 */
export const PLUGIN_CATALOG_ENVELOPE_SCHEMA_VERSION = 1 as const;

/** 只保存可公开的 PEM 公钥；按 key id 查找，轮换时新增，泄露时删除。 */
export type TrustedPluginCatalogKeys = Readonly<Record<string, string>>;

/** 已通过验签、有效期与回放检查的 catalog；只有它能作为 catalog-official 来源的依据。 */
export interface VerifiedPluginCatalog {
  readonly keyId: string;
  /** payload 原始字节的 SHA-256（hex），写入安装回执用于追溯。 */
  readonly digest: string;
  /** 原始信封文本；写入安装回执，启动期可离线复核签名。 */
  readonly envelope: string;
  readonly channel: PluginCatalogChannel;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** 已剔除被撤回的版本。 */
  readonly plugins: readonly SignedPluginCatalogEntry[];
  readonly runtimes: readonly PluginRuntimeEntry[];
  readonly revoked: readonly PluginCatalogRevocation[];
}

/** 本机记住的最近一份已接受 catalog；用来拒绝回退到旧序号或同序号的不同内容。 */
export interface PluginCatalogHighWaterMark {
  readonly sequence: number;
  readonly digest: string;
}

export type PluginCatalogRejectionCode =
  | 'malformed'
  | 'untrusted-key'
  | 'bad-signature'
  | 'insecure-url'
  | 'wrong-channel'
  | 'expired'
  | 'not-yet-valid'
  | 'rollback';

export class PluginCatalogRejectedError extends Error {
  readonly cause?: unknown;

  constructor(readonly code: PluginCatalogRejectionCode, message: string, options: { readonly cause?: unknown } = {}) {
    super(message);
    this.name = 'PluginCatalogRejectedError';
    this.cause = options.cause;
  }
}
