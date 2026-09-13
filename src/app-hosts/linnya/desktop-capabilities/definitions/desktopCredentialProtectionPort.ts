import type { CredentialProtectionPort } from '../../../../shared/credential-protection';

/**
 * App Server 需要的系统凭据保护能力。实现位于 Desktop Host；异步合同允许它通过
 * reverse RPC 调用系统 keyring，业务 registry 在 initialize/put 阶段等待结果。
 */
export type DesktopCredentialProtectionPort = CredentialProtectionPort;
