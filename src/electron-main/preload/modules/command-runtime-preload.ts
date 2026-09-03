import type { IpcRendererEvent } from 'electron';
import {
  COMMAND_APPROVAL_CHANGED_CHANNEL,
  COMMAND_APPROVAL_PAGE_OPEN_CHANNEL,
  COMMAND_APPROVAL_REPLY_CHANNEL,
  COMMAND_CARD_CANCEL_CHANNEL,
  COMMAND_CARD_CONTROL_CHANGED_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL,
  COMMAND_PROTECTED_INPUT_CHANNEL,
} from '@app/schemas/commands';

export interface CommandRuntimeIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (event: IpcRendererEvent, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, payload: unknown) => void,
  ): void;
}

export function buildCommandRuntimePreloadApi(ipcRenderer: CommandRuntimeIpcRenderer) {
  return {
    openCommandApprovalPage: (): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_APPROVAL_PAGE_OPEN_CHANNEL)
    ),
    replyToCommandApproval: (submission: unknown): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_APPROVAL_REPLY_CHANNEL, submission)
    ),
    onCommandApprovalChanged(callback: (event: unknown) => void): () => void {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload);
      };
      ipcRenderer.on(COMMAND_APPROVAL_CHANGED_CHANNEL, listener);
      return () => ipcRenderer.removeListener(COMMAND_APPROVAL_CHANGED_CHANNEL, listener);
    },
    openCommandCardControlPage: (request: unknown): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL, request)
    ),
    closeCommandCardControlPage: (request: unknown): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL, request)
    ),
    cancelCommandFromCard: (submission: unknown): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_CARD_CANCEL_CHANNEL, submission)
    ),
    submitCommandProtectedInput: (submission: unknown): Promise<unknown> => (
      ipcRenderer.invoke(COMMAND_PROTECTED_INPUT_CHANNEL, submission)
    ),
    onCommandCardControlChanged(callback: (event: unknown) => void): () => void {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload);
      ipcRenderer.on(COMMAND_CARD_CONTROL_CHANGED_CHANNEL, listener);
      return () => ipcRenderer.removeListener(COMMAND_CARD_CONTROL_CHANGED_CHANNEL, listener);
    },
  };
}
