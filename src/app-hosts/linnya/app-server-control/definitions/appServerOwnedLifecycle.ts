export interface AppServerReadyFacts {
  readonly applicationVersion: string;
  readonly apiPort: number;
  readonly rendererSessionToken: string;
  readonly databaseReady: true;
}

export interface AppServerOwnedLifecycle {
  /** ready 只能在全部业务 owner、HTTP/SSE 和数据库 owner 可接流量后发布。 */
  readonly ready: Promise<AppServerReadyFacts>;
  shutdown(): Promise<void>;
}
