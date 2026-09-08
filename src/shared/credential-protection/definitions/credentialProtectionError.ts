/**
 * Desktop safeStorage 失败在跨进程边界上的稳定分类。
 *
 * Electron 的原始错误文案属于平台实现细节，不能被 domain store 当作合同解析。
 */
export type CredentialProtectionErrorCode =
  | 'temporarily_unavailable'
  | 'invalidated'
  | 'malformed_ciphertext'
  | 'unknown';

const WIRE_PREFIX = 'linnya_credential_protection_error:';

const DEFAULT_MESSAGES: Readonly<Record<CredentialProtectionErrorCode, string>> = {
  temporarily_unavailable: '系统安全存储暂时不可用。',
  invalidated: '系统安全存储无法解密该凭据。',
  malformed_ciphertext: '凭据密文格式无效。',
  unknown: '系统安全存储处理凭据时发生未知错误。',
};

export class CredentialProtectionError extends Error {
  readonly code: CredentialProtectionErrorCode;

  constructor(code: CredentialProtectionErrorCode, message = DEFAULT_MESSAGES[code]) {
    super(message);
    this.name = 'CredentialProtectionError';
    this.code = code;
  }
}

/** 将受控错误压缩成可穿过通用 RPC error.message 的稳定标记。 */
export function encodeCredentialProtectionError(error: unknown): Error {
  if (error instanceof CredentialProtectionError) {
    return new Error(`${WIRE_PREFIX}${error.code}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** 从 RPC 包装后的错误中恢复凭据保护错误；其它业务错误保持原样。 */
export function decodeCredentialProtectionError(error: unknown): CredentialProtectionError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const code = (Object.keys(DEFAULT_MESSAGES) as CredentialProtectionErrorCode[]).find(candidate =>
    message.includes(`${WIRE_PREFIX}${candidate}`),
  );
  return code ? new CredentialProtectionError(code) : undefined;
}

/** Domain store 将未知解密异常统一收敛为不可用状态，避免泄漏平台错误文案。 */
export function readCredentialProtectionErrorCode(
  error: unknown,
): CredentialProtectionErrorCode {
  if (error instanceof CredentialProtectionError) return error.code;
  return decodeCredentialProtectionError(error)?.code ?? 'invalidated';
}
