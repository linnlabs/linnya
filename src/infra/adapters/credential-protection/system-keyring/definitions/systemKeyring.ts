export interface SystemKeyringEntry {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
}

export interface SystemKeyringEntryFactory {
  create(service: string, account: string): SystemKeyringEntry;
}
