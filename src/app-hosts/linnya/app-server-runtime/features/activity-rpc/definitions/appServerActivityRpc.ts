export const BACKEND_APP_ACTIVITY_READ_RPC_METHOD = 'backend.app_activity.read' as const;

export interface AppServerActivitySnapshot {
  readonly hasExecutingCommands: boolean;
}

export interface AppServerActivityGatewayPort {
  read(): Promise<AppServerActivitySnapshot>;
}
