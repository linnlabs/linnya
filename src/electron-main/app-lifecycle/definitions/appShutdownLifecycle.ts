export type AppShutdownIntent = 'ordinary_exit' | 'install_update' | 'startup_failure';

export type UserPreparedAppShutdownIntent = Exclude<AppShutdownIntent, 'startup_failure'>;

export type AppShutdownPhase =
  | 'running'
  | 'preparing_exit'
  | 'shutdown_committed'
  | 'update_handoff'
  | 'exited';

export type AppShutdownPreparation = 'kept_open' | 'ready_to_quit';

export type AppShutdownRequestOutcome =
  | 'kept_open'
  | 'shutdown_committed'
  | 'update_not_ready'
  | 'intent_conflict';

export interface AppShutdownCompletion {
  readonly intent: AppShutdownIntent;
  readonly exitCode: 0 | 1 | null;
  readonly completed: boolean;
  readonly updateHandoffStarted: boolean;
}

export interface UpdateHandoffPort {
  isReady(): boolean;
  handoff(): void;
}

export interface AppShutdownLifecyclePorts {
  readonly prepareAppShutdown: (
    intent: UserPreparedAppShutdownIntent,
  ) => Promise<AppShutdownPreparation>;
  readonly commitWindowClosePermission: () => void;
  readonly requestElectronQuit: () => void;
  readonly runShutdownStages: () => Promise<void>;
  readonly drainDiagnosticLog: () => Promise<void>;
  readonly exitElectron: (exitCode: 0 | 1) => void;
  readonly updateHandoff: UpdateHandoffPort;
}

export interface AppShutdownLifecycle {
  requestOrdinaryExit(): Promise<AppShutdownRequestOutcome>;
  requestInstallUpdate(onCommitted?: () => void): Promise<AppShutdownRequestOutcome>;
  requestStartupFailure(): void;
  completeCommittedShutdown(): Promise<AppShutdownCompletion>;
  getPhase(): AppShutdownPhase;
  getIntent(): AppShutdownIntent | undefined;
  isWindowClosePermitted(): boolean;
  isUpdateHandoffInProgress(): boolean;
  canAcceptWindowRequest(): boolean;
}
