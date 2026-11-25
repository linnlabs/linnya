import type {
  WindowCloseDecision,
  WindowCloseDecisionDismissMessage,
  WindowCloseDecisionPresentedMessage,
  WindowCloseDecisionRequestMessage,
  WindowCloseDecisionResultMessage,
  WindowClosePrompt,
  WindowCloseRendererReadyMessage,
  WindowCloseRendererSessionId,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';

/** `unavailable`：界面没有就绪、没有响应或已经消失，由调用方改用系统框。 */
export type WindowCloseDecisionAnswer = WindowCloseDecision | 'unavailable';

export interface WindowCloseDecisionHostPorts {
  readonly createRequest: (
    rendererSessionId: WindowCloseRendererSessionId,
    prompt: WindowClosePrompt,
  ) => WindowCloseDecisionRequestMessage;
  readonly sendRequest: (message: WindowCloseDecisionRequestMessage) => void;
  readonly sendDismiss: (message: WindowCloseDecisionDismissMessage) => void;
  /** 返回取消函数。 */
  readonly startPresentationTimeout: (onTimeout: () => void) => () => void;
}

export interface WindowCloseDecisionHost {
  markRendererReady(message: WindowCloseRendererReadyMessage): void;
  /** 页面已切换或 renderer 已经消失。 */
  rendererUnavailable(): void;
  /** 弹窗画出来之后界面又没有响应。 */
  rendererUnresponsive(): void;
  markPresented(message: WindowCloseDecisionPresentedMessage): void;
  resolveDecision(message: WindowCloseDecisionResultMessage): void;
  ask(prompt: WindowClosePrompt): Promise<WindowCloseDecisionAnswer>;
}
