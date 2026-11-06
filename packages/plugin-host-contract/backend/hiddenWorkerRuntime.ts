export interface HiddenWorkerRequestEnvelope {
  readonly requestId: string;
  readonly payload: unknown;
}

export interface HiddenWorkerResponseEnvelope<TResponse = unknown> {
  readonly requestId: string;
  readonly response: TResponse;
}

/**
 * 光栅Worker按串行任务以invoke(channel, {width,height})申请物理像素视口。
 * 响应为{width,height,scaleFactor}：实际content CSS尺寸及窗口所属屏幕倍率。
 * 窗口与屏幕换算仍由Desktop拥有；必须等响应后再调整绘图倍率并等待新帧。
 */
export interface HiddenWorkerRenderViewport {
  readonly channel: string;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
}

/**
 * 动态 worker registry 只能按字符串 id 寻址，因此其真实边界是 unknown。
 * definition 必须在 create/parse codec 内恢复领域类型，不能靠调用方泛型断言。
 */
interface HiddenWorkerDefinitionBase {
  readonly id: string;
  readonly requestChannel: string;
  readonly responseChannel: string;
  readonly readyChannel: string;
  readonly workerHtmlPath: string;
  readonly preloadPath: string;
  readonly partition?: string;
  /** 需要实际绘制的 worker 必须选择 offscreen；background 仅承诺排版。 */
  readonly renderingMode?: 'background' | 'offscreen';
  /** 只有绘制 DOM 子树的 worker 才启用 HTML-in-Canvas 实验能力。 */
  readonly htmlCanvas?: boolean;
  readonly renderViewport?: HiddenWorkerRenderViewport;
  readonly createRequestPayload: (request: unknown) => HiddenWorkerRequestEnvelope;
  readonly parseResponsePayload: (payload: unknown) => HiddenWorkerResponseEnvelope;
  readonly parseReadyPayload: (payload: unknown) => void;
  readonly extractRequestIdFromInvalidPayload?: (payload: unknown) => string | null;
  readonly idleTimeoutMs?: number;
  readonly readyTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxConsecutiveTimeouts?: number;
}

type HiddenWorkerCancellationDefinition =
  | {
      readonly cancelChannel: string;
      readonly createCancelPayload: (requestId: string) => unknown;
    }
  | {
      readonly cancelChannel?: never;
      readonly createCancelPayload?: never;
    };

export type HiddenWorkerDefinition = HiddenWorkerDefinitionBase & HiddenWorkerCancellationDefinition;

export interface HiddenWorkerRegistrationOptions {
  readonly replace?: boolean;
}

export declare function registerHiddenWorker(
  definition: HiddenWorkerDefinition,
  options?: HiddenWorkerRegistrationOptions,
): Promise<void>;
export declare function unregisterHiddenWorker(workerId: string): Promise<boolean>;
export declare function hasHiddenWorker(workerId: string): boolean;
export declare function listHiddenWorkerIds(): readonly string[];
export declare function ensureHiddenWorkerReady(workerId: string): Promise<void>;
export declare function touchHiddenWorker(workerId: string): void;
export declare function invokeHiddenWorker(
  workerId: string,
  request: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<unknown>;
