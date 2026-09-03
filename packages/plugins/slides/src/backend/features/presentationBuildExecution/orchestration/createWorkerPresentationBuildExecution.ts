import { randomUUID } from 'node:crypto';

import type { TypecheckResult } from '../../../sandbox/codegenTypecheck';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import type {
  PresentationBuildWorkerMaterializeRequest,
  PresentationBuildWorkerRequest,
  PresentationBuildWorkerResponse,
} from '../definitions/presentationBuildWorkerProtocol';
import {
  PresentationBuildExecutionError,
  PresentationFormulaBuildExecutionError,
  type PresentationComposeCompilationResult,
  type PresentationBuildExecutionRuntime,
  type PresentationMaterializationInput,
} from '../definitions/presentationBuildExecution';
import {
  createPresentationBuildWorkerCompileComposeRequest,
  createPresentationBuildWorkerMaterializeRequest,
  createPresentationBuildWorkerTypecheckRequest,
  parsePresentationBuildWorkerResponse,
} from '../functions/presentationBuildWorkerCodec';
import {
  createPresentationBuildWorkerTransport,
  type PresentationBuildWorkerTransport,
  type PresentationBuildWorkerTransportFactory,
} from '../infrastructure/presentationBuildWorkerTransport';

interface QueuedBuildRequest {
  readonly request: PresentationBuildWorkerRequest;
  readonly transferList: readonly ArrayBuffer[];
  readonly timeoutMs: number;
  readonly acceptResponse: (response: PresentationBuildWorkerResponse) => boolean;
  readonly reject: (error: PresentationBuildExecutionError) => void;
}

const DEFAULT_MAX_QUEUED_REQUESTS = 2;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MATERIALIZATION_TIMEOUT_MS = 60_000;

export function createWorkerPresentationBuildExecution(input: {
  readonly workerPath: string;
  readonly maxQueuedRequests?: number;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly materializationTimeoutMs?: number;
  readonly createTransport?: PresentationBuildWorkerTransportFactory;
}): PresentationBuildExecutionRuntime {
  const createTransport = input.createTransport ?? createPresentationBuildWorkerTransport;
  const maxQueuedRequests = input.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS;
  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const materializationTimeoutMs = input.materializationTimeoutMs
    ?? DEFAULT_MATERIALIZATION_TIMEOUT_MS;
  const queue: QueuedBuildRequest[] = [];
  let transport: PresentationBuildWorkerTransport | undefined;
  let starting: Promise<PresentationBuildWorkerTransport> | undefined;
  let startingTransport: PresentationBuildWorkerTransport | undefined;
  let rejectStarting: ((error: PresentationBuildExecutionError) => void) | undefined;
  let active: QueuedBuildRequest | undefined;
  let activeTimeout: NodeJS.Timeout | undefined;
  let closed = false;
  let workerGeneration = 0;

  const clearActiveTimeout = (): void => {
    if (!activeTimeout) return;
    clearTimeout(activeTimeout);
    activeTimeout = undefined;
  };

  const rejectAll = (error: PresentationBuildExecutionError): void => {
    clearActiveTimeout();
    const activeRequest = active;
    active = undefined;
    activeRequest?.reject(error);
    for (const request of queue.splice(0)) request.reject(error);
  };

  const failWorker = (
    generation: number,
    error: PresentationBuildExecutionError,
  ): void => {
    if (generation !== workerGeneration) return;
    workerGeneration += 1;
    const failedTransport = transport;
    transport = undefined;
    starting = undefined;
    rejectAll(error);
    if (failedTransport) void failedTransport.terminate();
  };

  const handleResponse = (generation: number, message: unknown): void => {
    if (generation !== workerGeneration) return;
    let response: PresentationBuildWorkerResponse;
    try {
      response = parsePresentationBuildWorkerResponse(message);
    } catch (error) {
      failWorker(
        generation,
        new PresentationBuildExecutionError(
          'protocol',
          error instanceof Error ? error.message : 'Slides build worker response is invalid.',
        ),
      );
      return;
    }
    if (response.type === 'ready') return;
    if (!active || response.requestId !== active.request.requestId) {
      failWorker(
        generation,
        new PresentationBuildExecutionError(
          'protocol',
          'Slides build worker response does not match the active request.',
        ),
      );
      return;
    }

    const completed = active;
    active = undefined;
    clearActiveTimeout();
    if (response.type === 'failure') {
      if (response.failure.kind === 'formula') {
        completed.reject(new PresentationFormulaBuildExecutionError(
          response.failure.code,
          response.message,
        ));
        void pump();
        return;
      }
      active = completed;
      failWorker(
        generation,
        new PresentationBuildExecutionError('unavailable', response.message),
      );
      return;
    }
    if (!completed.acceptResponse(response)) {
      active = completed;
      failWorker(
        generation,
        new PresentationBuildExecutionError(
          'protocol',
          'Slides build worker returned the wrong result type for the active request.',
        ),
      );
      return;
    }
    void pump();
  };

  const startWorker = (): Promise<PresentationBuildWorkerTransport> => {
    if (transport) return Promise.resolve(transport);
    if (starting) return starting;
    const generation = workerGeneration + 1;
    workerGeneration = generation;
    starting = new Promise((resolve, reject) => {
      const worker = createTransport(input.workerPath);
      startingTransport = worker;
      rejectStarting = reject;
      let ready = false;
      const startupTimeout = setTimeout(() => {
        if (ready || generation !== workerGeneration) return;
        void worker.terminate();
        const error = new PresentationBuildExecutionError(
          'timeout',
          'Slides build worker did not become ready before its startup deadline.',
        );
        workerGeneration += 1;
        starting = undefined;
        startingTransport = undefined;
        rejectStarting = undefined;
        reject(error);
      }, startupTimeoutMs);

      worker.onMessage((message) => {
        if (!ready) {
          try {
            const response = parsePresentationBuildWorkerResponse(message);
            if (response.type !== 'ready') {
              throw new Error('Slides build worker sent work before its ready message.');
            }
            if (closed || generation !== workerGeneration) {
              clearTimeout(startupTimeout);
              void worker.terminate();
              starting = undefined;
              startingTransport = undefined;
              rejectStarting = undefined;
              reject(new PresentationBuildExecutionError(
                'closed',
                'Slides build execution runtime was stopped during startup.',
              ));
              return;
            }
            ready = true;
            clearTimeout(startupTimeout);
            transport = worker;
            starting = undefined;
            startingTransport = undefined;
            rejectStarting = undefined;
            resolve(worker);
          } catch (error) {
            clearTimeout(startupTimeout);
            void worker.terminate();
            if (generation === workerGeneration) workerGeneration += 1;
            starting = undefined;
            startingTransport = undefined;
            rejectStarting = undefined;
            reject(new PresentationBuildExecutionError(
              'protocol',
              error instanceof Error ? error.message : 'Slides build worker ready message is invalid.',
            ));
          }
          return;
        }
        handleResponse(generation, message);
      });
      worker.onError((error) => {
        clearTimeout(startupTimeout);
        if (!ready) {
          if (generation === workerGeneration) workerGeneration += 1;
          starting = undefined;
          startingTransport = undefined;
          rejectStarting = undefined;
          reject(new PresentationBuildExecutionError('unavailable', error.message));
          return;
        }
        failWorker(
          generation,
          new PresentationBuildExecutionError('unavailable', 'Slides build worker crashed.'),
        );
      });
      worker.onExit((exitCode) => {
        clearTimeout(startupTimeout);
        if (closed || generation !== workerGeneration) return;
        if (!ready) {
          workerGeneration += 1;
          starting = undefined;
          startingTransport = undefined;
          rejectStarting = undefined;
          reject(new PresentationBuildExecutionError(
            'unavailable',
            `Slides build worker exited during startup (${exitCode}).`,
          ));
          return;
        }
        failWorker(
          generation,
          new PresentationBuildExecutionError(
            'unavailable',
            `Slides build worker exited unexpectedly (${exitCode}).`,
          ),
        );
      });
    });
    return starting;
  };

  async function pump(): Promise<void> {
    if (closed || active || queue.length === 0) return;
    active = queue.shift();
    if (!active) return;
    let worker: PresentationBuildWorkerTransport;
    try {
      worker = await startWorker();
    } catch (error) {
      const failure = error instanceof PresentationBuildExecutionError
        ? error
        : new PresentationBuildExecutionError('unavailable', 'Slides build worker is unavailable.');
      rejectAll(failure);
      return;
    }
    if (closed || !active) return;
    const requestId = active.request.requestId;
    activeTimeout = setTimeout(() => {
      if (!active || active.request.requestId !== requestId) return;
      failWorker(
        workerGeneration,
        new PresentationBuildExecutionError(
          'timeout',
          'Slides build worker exceeded the request deadline.',
        ),
      );
    }, active.timeoutMs);
    try {
      worker.postMessage(active.request, active.transferList);
    } catch (error) {
      failWorker(
        workerGeneration,
        new PresentationBuildExecutionError(
          'protocol',
          error instanceof Error ? error.message : 'Slides build request could not be encoded.',
        ),
      );
    }
  }

  return Object.freeze({
    typecheckCodegenSource(source: string): Promise<TypecheckResult> {
      if (closed) {
        return Promise.reject(new PresentationBuildExecutionError(
          'closed',
          'Slides build execution runtime is closed.',
        ));
      }
      if (queue.length >= maxQueuedRequests) {
        return Promise.reject(new PresentationBuildExecutionError(
          'busy',
          'Slides build execution capacity is currently full.',
        ));
      }
      let request: PresentationBuildWorkerRequest;
      try {
        request = createPresentationBuildWorkerTypecheckRequest({
          requestId: randomUUID(),
          source,
        });
      } catch (error) {
        return Promise.reject(new PresentationBuildExecutionError(
          'protocol',
          error instanceof Error ? error.message : 'Slides build request could not be encoded.',
        ));
      }
      return new Promise((resolve, reject) => {
        queue.push({
          request,
          transferList: [],
          timeoutMs: requestTimeoutMs,
          acceptResponse(response) {
            if (response.type !== 'typecheck_result') return false;
            resolve(response.result);
            return true;
          },
          reject,
        });
        void pump();
      });
    },
    compileComposePayload(
      payload: SandboxJsonObject,
    ): Promise<PresentationComposeCompilationResult> {
      if (closed) {
        return Promise.reject(new PresentationBuildExecutionError(
          'closed',
          'Slides build execution runtime is closed.',
        ));
      }
      if (queue.length >= maxQueuedRequests) {
        return Promise.reject(new PresentationBuildExecutionError(
          'busy',
          'Slides build execution capacity is currently full.',
        ));
      }
      let request: PresentationBuildWorkerRequest;
      try {
        request = createPresentationBuildWorkerCompileComposeRequest({
          requestId: randomUUID(),
          payload,
        });
      } catch (error) {
        return Promise.reject(new PresentationBuildExecutionError(
          'protocol',
          error instanceof Error ? error.message : 'Slides build request could not be encoded.',
        ));
      }
      return new Promise((resolve, reject) => {
        queue.push({
          request,
          transferList: [],
          timeoutMs: requestTimeoutMs,
          acceptResponse(response) {
            if (response.type !== 'compile_compose_result') return false;
            resolve(response.result);
            return true;
          },
          reject,
        });
        void pump();
      });
    },
    materializePresentation(
      materialization: PresentationMaterializationInput,
    ): Promise<ArrayBuffer> {
      if (closed) {
        return Promise.reject(new PresentationBuildExecutionError(
          'closed',
          'Slides build execution runtime is closed.',
        ));
      }
      if (queue.length >= maxQueuedRequests) {
        return Promise.reject(new PresentationBuildExecutionError(
          'busy',
          'Slides build execution capacity is currently full.',
        ));
      }
      let request: PresentationBuildWorkerMaterializeRequest;
      try {
        request = createPresentationBuildWorkerMaterializeRequest({
          requestId: randomUUID(),
          materialization,
        });
      } catch (error) {
        return Promise.reject(new PresentationBuildExecutionError(
          'contract',
          error instanceof Error ? error.message : 'Slides build request could not be encoded.',
        ));
      }
      const transferList = request.svgFallbacks.map(fallback => fallback.pngBytes);
      return new Promise((resolve, reject) => {
        queue.push({
          request,
          transferList,
          timeoutMs: materializationTimeoutMs,
          acceptResponse(response) {
            if (response.type !== 'materialize_result') return false;
            resolve(response.buffer);
            return true;
          },
          reject,
        });
        void pump();
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      workerGeneration += 1;
      rejectAll(new PresentationBuildExecutionError(
        'closed',
        'Slides build execution runtime was stopped.',
      ));
      const runningTransport = transport;
      const bootingTransport = startingTransport;
      const rejectBoot = rejectStarting;
      transport = undefined;
      starting = undefined;
      startingTransport = undefined;
      rejectStarting = undefined;
      rejectBoot?.(new PresentationBuildExecutionError(
        'closed',
        'Slides build execution runtime was stopped during startup.',
      ));
      await Promise.all([
        ...(runningTransport ? [runningTransport.terminate()] : []),
        ...(bootingTransport && bootingTransport !== runningTransport
          ? [bootingTransport.terminate()]
          : []),
      ]);
    },
  });
}
