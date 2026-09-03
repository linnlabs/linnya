// 中文说明：文档 surface 类型由插件 documentType 贡献注册，不再维护闭合 union。
export type DocumentSurfaceType = string;

export interface WaitForDocumentSurfaceReadyOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DocumentSurfaceReadyRef {
  type: DocumentSurfaceType;
  id: string;
}

export interface DocumentSurfaceRuntimePort {
  markSurfaceReady(surface: DocumentSurfaceReadyRef): void;
  clearSurfaceReady(surface?: DocumentSurfaceReadyRef): void;
  waitForSurfaceReady(
    surface: DocumentSurfaceReadyRef,
    options?: WaitForDocumentSurfaceReadyOptions,
  ): Promise<void>;
}

let registeredPort: DocumentSurfaceRuntimePort | null = null;

export function registerDocumentSurfaceRuntimePort(port: DocumentSurfaceRuntimePort): void {
  registeredPort = port;
}

export function getDocumentSurfaceRuntimePort(): DocumentSurfaceRuntimePort {
  if (!registeredPort) {
    throw new Error('[documentSurfaceRuntimePort] Document surface runtime port is not registered.');
  }
  return registeredPort;
}
