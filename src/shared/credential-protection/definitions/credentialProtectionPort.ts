/**
 * 宿主提供的凭据保护边界。业务域只持久化密文，不感知 Electron、CLI 或系统 keyring。
 */
export interface CredentialProtectionPort {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  /** 旧宿主密文成功迁移时返回新密文；当前格式返回 undefined。 */
  rewrap(ciphertext: string): Promise<string | undefined>;
}
