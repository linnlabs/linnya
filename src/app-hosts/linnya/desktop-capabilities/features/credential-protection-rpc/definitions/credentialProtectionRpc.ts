export const DESKTOP_CREDENTIAL_ENCRYPT_RPC_METHOD =
  'desktop.credential_protection.encrypt' as const;
export const DESKTOP_CREDENTIAL_DECRYPT_RPC_METHOD =
  'desktop.credential_protection.decrypt' as const;

export interface DesktopCredentialEncryptRpcRequest {
  readonly plaintext: string;
}

export interface DesktopCredentialEncryptRpcResponse {
  readonly ciphertext: string;
}

export interface DesktopCredentialDecryptRpcRequest {
  readonly ciphertext: string;
}

export interface DesktopCredentialDecryptRpcResponse {
  readonly plaintext: string;
}
