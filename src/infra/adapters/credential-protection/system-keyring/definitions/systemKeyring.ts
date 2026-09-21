export interface SystemKeyringEntry {
  /**
   * Reads the raw secret so the native adapter can preserve store errors.
   * The native adapter may return `null` or `undefined` for an absent entry;
   * this boundary normalizes both to `undefined`. A rejected promise means
   * the store exists but cannot currently be read (for example an ACL denial).
   */
  getSecret(): Promise<Uint8Array | null | undefined>;
  /** 兼容 2.x 之前已经写入的 password 形态 keychain item。 */
  getPassword(): Promise<string | null | undefined>;
  setPassword(password: string): Promise<void>;
}

export interface SystemKeyringEntryFactory {
  create(service: string, account: string): SystemKeyringEntry;
}
