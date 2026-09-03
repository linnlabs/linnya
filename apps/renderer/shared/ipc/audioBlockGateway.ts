/**
 * @file apps/renderer/shared/ipc/audioBlockGateway.ts
 * @description AudioBlock 专属 IPC 网关
 */

// OperationResult 类型从 workspaceGateway 导入，以便重用
import type { OperationResult } from './workspaceGateway';

export interface IAudioBlockGateway {
  'get-all-content'(args: { audioBlockId: string }): Promise<OperationResult<any>>;
  'update-note'(args: { audioBlockId: string; documentNodeId: string; content: string }): Promise<OperationResult<void>>;
  'update-transcript'(args: { audioBlockId: string; documentNodeId: string; content: string; translationLanguage?: string | null; translationVisible?: boolean; textColumnWidth?: number }): Promise<OperationResult<void>>;
  'update-summary'(args: { audioBlockId: string; documentNodeId: string; content: string }): Promise<OperationResult<void>>;
}

class AudioBlockGatewayImpl implements IAudioBlockGateway {
  private electronAPI: any;

  constructor() {
    if (!(window as any).electronAPI) {
      throw new Error('[AudioBlockGateway] window.electronAPI is not available');
    }
    this.electronAPI = (window as any).electronAPI;
  }

  private async invoke<T>(channel: string, ...args: any[]): Promise<OperationResult<T>> {
    const ipcChannel = `audio-block:${channel}`;
    try {
      if (typeof this.electronAPI[ipcChannel] !== 'function') {
        throw new Error(`IPC channel "${ipcChannel}" is not a function on electronAPI.`);
      }
      const result = await this.electronAPI[ipcChannel](...args);
      return result as OperationResult<T>;
    } catch (error) {
      console.error(`[AudioBlockGateway] IPC call to "${ipcChannel}" failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown IPC error on channel ${ipcChannel}`,
      };
    }
  }

  'get-all-content'(args: { audioBlockId: string }): Promise<OperationResult<any>> {
    return this.invoke('get-all-content', args);
  }
  'update-note'(args: { audioBlockId: string; documentNodeId: string; content: string }): Promise<OperationResult<void>> {
    return this.invoke('update-note', args);
  }
  'update-transcript'(args: { audioBlockId: string; documentNodeId: string; content: string; translationLanguage?: string | null; translationVisible?: boolean; textColumnWidth?: number }): Promise<OperationResult<void>> {
    return this.invoke('update-transcript', args);
  }
  'update-summary'(args: { audioBlockId: string; documentNodeId: string; content: string }): Promise<OperationResult<void>> {
    return this.invoke('update-summary', args);
  }
}

export const audioBlockGateway: IAudioBlockGateway = new AudioBlockGatewayImpl();
