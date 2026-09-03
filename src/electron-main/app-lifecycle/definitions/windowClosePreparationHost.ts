import type {
  WindowClosePreparationResultMessage,
  WindowCloseRendererReadyMessage,
  WindowCloseRequestMessage,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';

export interface WindowCloseRendererIdentity {
  readonly webContentsId: number;
  readonly rendererSessionId: WindowCloseRendererReadyMessage['renderer_session_id'];
}

export interface WindowClosePreparationHostPorts {
  readonly createRequest: (
    identity: WindowCloseRendererIdentity,
  ) => WindowCloseRequestMessage;
  readonly sendRequest: (request: WindowCloseRequestMessage) => void;
}

export interface WindowClosePreparationHost {
  markRendererReady(message: WindowCloseRendererReadyMessage): void;
  invalidateRenderer(): void;
  resolvePreparation(message: WindowClosePreparationResultMessage): void;
  rendererUnavailable(): void;
  prepare(): Promise<void>;
}
