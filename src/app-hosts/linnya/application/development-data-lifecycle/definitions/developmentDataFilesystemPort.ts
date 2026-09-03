export interface DevelopmentDataDirectorySnapshot {
  readonly exists: boolean;
  readonly topLevelEntries: readonly string[];
}

export interface DevelopmentDataFilesystemPort {
  inspectDirectory(directory: string): Promise<DevelopmentDataDirectorySnapshot>;
  readTextIfExists(filePath: string): Promise<string | null>;
  writeTextAtomically(filePath: string, content: string): Promise<void>;
  measureDirectory(directory: string): Promise<number>;
  retireDirectory(source: string, retiredRoot: string, retiredName: string): Promise<string>;
}
