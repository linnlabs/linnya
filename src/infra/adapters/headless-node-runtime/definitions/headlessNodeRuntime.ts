export interface HeadlessNodeRuntimeTarget {
  readonly platform: 'darwin' | 'win32';
  readonly architecture: 'arm64' | 'x64';
  readonly archiveFileName: string;
  readonly archiveSha256: string;
  readonly executableRelativePath: string;
}

export interface HeadlessNodeRuntimeCatalog {
  readonly schemaVersion: 1;
  readonly runtimeId: 'linnya_headless_node_runtime';
  readonly nodeVersion: string;
  readonly targets: readonly HeadlessNodeRuntimeTarget[];
}

export interface ResolvedHeadlessNodeRuntime {
  readonly nodeVersion: string;
  readonly manifestPath: string;
  readonly executablePath: string;
}
