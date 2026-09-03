import type { EndpointCredentialCodec } from '../../../../domains/model-catalog';
import type { ProviderAccountCredentialCodec } from '../../../../domains/provider-account';

/**
 * App Server 需要的系统凭据保护能力。实现位于 Desktop Host；异步合同允许它通过
 * reverse RPC 调用 Electron safeStorage，业务 registry 在 initialize/put 阶段等待结果。
 */
export interface DesktopCredentialProtectionPort
  extends EndpointCredentialCodec, ProviderAccountCredentialCodec {}
