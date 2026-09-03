import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationFlowRouter } from 'src/app-hosts/linnya/adapters/flow/flow.router';
import type { ConversationNextRequest } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';

class MockResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];
  statusCode: number | undefined;
  jsonBody: unknown;
  writableEnded = false;
  endCallCount = 0;

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  write(chunk: string): void {
    this.writes.push(chunk);
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }

  end(): void {
    this.writableEnded = true;
    this.endCallCount += 1;
  }
}

function createValidRequestBody(
  overrides?: Partial<ConversationNextRequest>,
): ConversationNextRequest {
  return {
    conversation_id: 'conv_router_contract',
    new_events: [
      {
        type: 'user_input',
        id: 'user_evt_router_1',
        content: 'phase2 router contract',
        timestamp: Date.now(),
        source: 'user',
        turn_id: 'turn_router_1',
      },
    ],
    options: {
      persist: false,
    },
    ...(overrides ?? {}),
  };
}

type RouteHandler = (req: unknown, res: unknown) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPostNextHandler(router: ReturnType<typeof createConversationFlowRouter>): RouteHandler {
  const stack = Reflect.get(router, 'stack');
  if (!Array.isArray(stack)) throw new Error('Expected an Express router stack');

  for (const layer of stack) {
    if (!isRecord(layer) || !isRecord(layer.route)) continue;
    if (layer.route.path !== '/next' || !isRecord(layer.route.methods) || layer.route.methods.post !== true) {
      continue;
    }
    if (!Array.isArray(layer.route.stack)) break;
    const routeLayer = layer.route.stack[layer.route.stack.length - 1];
    if (!isRecord(routeLayer) || typeof routeLayer.handle !== 'function') break;
    const handle = routeLayer.handle;
    return (req, res) => {
      Reflect.apply(handle, undefined, [req, res]);
    };
  }

  throw new Error('POST /next handler was not registered');
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('Flow router/orchestrator contract regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps transport_end as orchestrator-owned single transport exit', async () => {
    const transportEndEvent = {
      type: 'transport_end',
      id: 'transport_end_router_contract_1',
      conversation_id: 'conv_router_contract',
      turn_id: 'turn_router_1',
      timestamp: Date.now(),
      execution_id: 'execution_router_contract_1',
      reason: 'complete',
    };
    const orchestrator = {
      next: vi.fn().mockImplementation(async (_body, sink) => {
        sink(transportEndEvent);
        return {
          conversation_id: 'conv_router_contract',
          events: [],
          stepCount: 0,
        };
      }),
    } as any;

    const handler = getPostNextHandler(createConversationFlowRouter(orchestrator));
    const req = { body: createValidRequestBody() };
    const res = new MockResponse();

    handler(req, res);
    await flushAsyncWork();

    expect(orchestrator.next).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv_router_contract',
      }),
      expect.any(Function),
      expect.any(AbortSignal),
      { persist: false },
    );
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.writes).toEqual([
      'event: transport_end\n',
      `data: ${JSON.stringify(transportEndEvent)}\n\n`,
    ]);
    expect(res.endCallCount).toBe(1);
  });

  it('does not write router-owned error SSE when orchestrator throws', async () => {
    const orchestrator = {
      next: vi.fn().mockRejectedValue(new Error('router contract failure')),
    } as any;

    const handler = getPostNextHandler(createConversationFlowRouter(orchestrator));
    const req = { body: createValidRequestBody({ options: { persist: true } }) };
    const res = new MockResponse();

    handler(req, res);
    await flushAsyncWork();

    expect(res.writes).toEqual([]);
    expect(res.endCallCount).toBe(1);
    expect(res.statusCode).toBeUndefined();
    expect(res.jsonBody).toBeUndefined();
  });

  it('aborts orchestrator signal on client close before response ends', async () => {
    let capturedSignal: AbortSignal | undefined;
    const orchestrator = {
      next: vi.fn().mockImplementation(
        async (_body: ConversationNextRequest, _sink: (event: unknown) => void, signal?: AbortSignal) => {
          capturedSignal = signal;
          await new Promise((_, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('aborted by client close');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          });
          return {
            conversation_id: 'conv_router_contract',
            events: [],
            stepCount: 0,
          };
        },
      ),
    } as any;

    const handler = getPostNextHandler(createConversationFlowRouter(orchestrator));
    const req = { body: createValidRequestBody({ options: { persist: true } }) };
    const res = new MockResponse();

    handler(req, res);
    await flushAsyncWork();
    res.emit('close');
    await flushAsyncWork();

    expect(capturedSignal?.aborted).toBe(true);
    expect(res.writes).toEqual([]);
    expect(res.endCallCount).toBe(1);
  });
});
