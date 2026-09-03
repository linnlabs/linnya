export interface HiddenWorkerRequestEnvelope {
  readonly requestId: string;
  readonly payload: unknown;
}

export interface HiddenWorkerResponseEnvelope<TResponse = unknown> {
  readonly requestId: string;
  readonly response: TResponse;
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
