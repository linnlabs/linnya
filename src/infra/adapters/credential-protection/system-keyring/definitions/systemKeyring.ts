export interface SystemKeyringEntry {
  /**
   * Reads the raw secret so the native adapter can preserve store errors.
   * `undefined` means the entry is absent; a rejected promise means the store
   * exists but cannot currently be read (for example an ACL denial).
   */
  getSecret(): Promise<Uint8Array | undefined>;
  /** 兼容 2.x 之前已经写入的 password 形态 keychain item。 */
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
}

export interface SystemKeyringEntryFactory {
  create(service: string, account: string): SystemKeyringEntry;
}
