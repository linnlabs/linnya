import { describe, expect, it, vi } from 'vitest';

import { PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION } from '../definitions/presentationBuildWorkerProtocol';
import type { PresentationBuildWorkerTransport } from '../infrastructure/presentationBuildWorkerTransport';
import { parsePresentationBuildWorkerRequest } from '../functions/presentationBuildWorkerCodec';
import { createWorkerPresentationBuildExecution } from './createWorkerPresentationBuildExecution';

class FakeBuildWorkerTransport implements PresentationBuildWorkerTransport {
  readonly posted: unknown[] = [];
  readonly postedTransfers: Array<readonly ArrayBuffer[]> = [];
  terminate = vi.fn(async () => 1);
  private messageListener: (message: unknown) => void = () => {};
  private errorListener: (error: Error) => void = () => {};
  private exitListener: (exitCode: number) => void = () => {};

  postMessage(message: unknown, transferList: readonly ArrayBuffer[] = []): void {
    this.posted.push(message);
    this.postedTransfers.push(transferList);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  onExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }

  emitReady(): void {
    this.messageListener({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'ready',
    });
  }

  emitMessage(message: unknown): void {
    this.messageListener(message);
  }

  completeNext(): void {
    const request = parsePresentationBuildWorkerRequest(this.posted.at(-1));
    if (request.type !== 'typecheck') {
      throw new Error('test expected a typecheck request');
    }
    this.messageListener({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'typecheck_result',
      requestId: request.requestId,
      result: { ok: true, elapsedMs: 4, message: '', records: [] },
    });
  }

  completeCompose(): void {
    const request = parsePresentationBuildWorkerRequest(this.posted.at(-1));
    if (request.type !== 'compile_compose') {
      throw new Error('test expected a compile compose request');
    }
    this.messageListener({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'compile_compose_result',
      requestId: request.requestId,
      result: { ok: true, input: request.payload },
    });
  }

  completeMaterialize(): void {
    const request = parsePresentationBuildWorkerRequest(this.posted.at(-1));
    if (request.type !== 'materialize') {
      throw new Error('test expected a materialize request');
    }
    this.messageListener({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'materialize_result',
      requestId: request.requestId,
      buffer: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer,
    });
  }

  failFormula(code: 'slides.formula.unsupported_syntax'): void {
    const request = parsePresentationBuildWorkerRequest(this.posted.at(-1));
    this.messageListener({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId: request.requestId,
      message: 'Formula command is not supported.',
      failure: { kind: 'formula', code },
    });
  }

  crash(): void {
    this.errorListener(new Error('worker crashed'));
    this.exitListener(1);
  }
}

describe('createWorkerPresentationBuildExecution', () => {
  it('runs one build at a time, bounds the feature queue and preserves request order', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      maxQueuedRequests: 2,
      createTransport: () => transport,
    });

    const first = runtime.typecheckCodegenSource('first();');
    const second = runtime.typecheckCodegenSource('second();');
    const third = runtime.typecheckCodegenSource('third();');
    await expect(runtime.typecheckCodegenSource('fourth();')).rejects.toMatchObject({
      kind: 'busy',
    });

    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));
    expect(parsePresentationBuildWorkerRequest(transport.posted[0])).toMatchObject({
      type: 'typecheck',
      source: 'first();',
    });
    transport.completeNext();
    await expect(first).resolves.toMatchObject({ ok: true });

    await vi.waitFor(() => expect(transport.posted).toHaveLength(2));
    expect(parsePresentationBuildWorkerRequest(transport.posted[1])).toMatchObject({
      type: 'typecheck',
      source: 'second();',
    });
    transport.completeNext();
    await expect(second).resolves.toMatchObject({ ok: true });

    await vi.waitFor(() => expect(transport.posted).toHaveLength(3));
    expect(parsePresentationBuildWorkerRequest(transport.posted[2])).toMatchObject({
      type: 'typecheck',
      source: 'third();',
    });
    transport.completeNext();
    await expect(third).resolves.toMatchObject({ ok: true });
    await runtime.close();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('dispatches compose/layout work through the same bounded worker owner', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => transport,
    });
    const payload = { title: 'Deck', slides: [] };

    const result = runtime.compileComposePayload(payload);
    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));
    expect(parsePresentationBuildWorkerRequest(transport.posted[0])).toMatchObject({
      type: 'compile_compose',
      payload,
    });
    transport.completeCompose();

    await expect(result).resolves.toEqual({ ok: true, input: payload });
    await runtime.close();
  });

  it('transfers prepared SVG fallback bytes and the PPTX result through the same owner', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => transport,
    });
    const fallbackBytes = Uint8Array.from([1, 2, 3, 4]);
    const canonicalSvg = '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>';

    const result = runtime.materializePresentation({
      deckSpec: {
        title: 'Deck',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'text',
              position: { x: 1, y: 1, w: 3, h: 1 },
              content: 'Hello',
            }],
          },
        }],
      },
      svgAssets: [{
        kind: 'owned_svg',
        assetId: 'svg-1',
        contentHash: 'hash-1',
        byteLength: Buffer.byteLength(canonicalSvg, 'utf8'),
        viewBox: { width: 10, height: 10 },
        canonicalSvg,
      }],
      svgFallbacks: [{
        assetId: 'svg-1',
        contentHash: 'hash-1',
        pngBytes: fallbackBytes,
        widthPx: 10,
        heightPx: 10,
      }],
    });
    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));
    expect(parsePresentationBuildWorkerRequest(transport.posted[0]).type).toBe('materialize');
    expect(transport.postedTransfers[0]).toHaveLength(1);
    transport.completeMaterialize();

    await expect(result).resolves.toBeInstanceOf(ArrayBuffer);
    await runtime.close();
  });

  it('reports deterministic materialization admission failures as contract errors', async () => {
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => new FakeBuildWorkerTransport(),
    });

    await expect(runtime.materializePresentation({
      deckSpec: {
        title: 'Invalid formula deck',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'formula',
              position: { x: 1, y: 1, w: 3, h: 1 },
              source: {
                latex: 'E=mc^2',
                display: 'block',
                profileVersion: 1,
                fontSize: 28,
                color: 'red',
                align: 'center',
                altText: '质能方程',
              },
            }],
          },
        }],
      },
      svgAssets: [],
      svgFallbacks: [],
    })).rejects.toMatchObject({
      kind: 'contract',
      message: 'Slides materialization deck spec is invalid.',
    });

    await runtime.close();
  });

  it('returns formula domain failures without terminating the healthy worker', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => transport,
    });

    const formula = runtime.materializePresentation({
      deckSpec: {
        title: 'Unsupported formula deck',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'formula',
              position: { x: 1, y: 1, w: 3, h: 1 },
              source: {
                latex: String.raw`\unknown{x}`,
                display: 'block',
                profileVersion: 1,
                fontSize: 28,
                color: '#000000',
                align: 'center',
                altText: 'Unsupported formula',
              },
            }],
          },
        }],
      },
      svgAssets: [],
      svgFallbacks: [],
    });
    const queued = runtime.typecheckCodegenSource('afterFormula();');
    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));
    transport.failFormula('slides.formula.unsupported_syntax');

    await expect(formula).rejects.toMatchObject({
      kind: 'formula',
      formulaCode: 'slides.formula.unsupported_syntax',
    });
    await vi.waitFor(() => expect(transport.posted).toHaveLength(2));
    transport.completeNext();
    await expect(queued).resolves.toMatchObject({ ok: true });
    expect(transport.terminate).not.toHaveBeenCalled();

    await runtime.close();
  });

  it('fails active and admitted queued work when the worker crashes without replaying it', async () => {
    const firstTransport = new FakeBuildWorkerTransport();
    const secondTransport = new FakeBuildWorkerTransport();
    const transports = [firstTransport, secondTransport];
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => {
        const next = transports.shift();
        if (!next) throw new Error('unexpected worker creation');
        return next;
      },
    });

    const active = runtime.typecheckCodegenSource('active();');
    const queued = runtime.typecheckCodegenSource('queued();');
    firstTransport.emitReady();
    await vi.waitFor(() => expect(firstTransport.posted).toHaveLength(1));
    firstTransport.crash();
    await expect(active).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(queued).rejects.toMatchObject({ kind: 'unavailable' });
    expect(firstTransport.posted).toHaveLength(1);

    const fresh = runtime.typecheckCodegenSource('fresh();');
    secondTransport.emitReady();
    await vi.waitFor(() => expect(secondTransport.posted).toHaveLength(1));
    secondTransport.completeNext();
    await expect(fresh).resolves.toMatchObject({ ok: true });
    await runtime.close();
  });

  it('terminates a worker that is still starting when the Slides runtime stops', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => transport,
    });

    const pending = runtime.typecheckCodegenSource('pending();');
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'closed' });
    await runtime.close();
    await rejected;
    expect(transport.terminate).toHaveBeenCalledOnce();
    expect(transport.posted).toHaveLength(0);
  });

  it('fails admitted work on a response protocol violation without replaying it', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      createTransport: () => transport,
    });

    const active = runtime.typecheckCodegenSource('active();');
    const queued = runtime.typecheckCodegenSource('queued();');
    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));
    transport.emitMessage({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'typecheck_result',
      requestId: 'not-the-active-request',
      result: { ok: true, elapsedMs: 1, message: '', records: [] },
    });

    await expect(active).rejects.toMatchObject({ kind: 'protocol' });
    await expect(queued).rejects.toMatchObject({ kind: 'protocol' });
    expect(transport.posted).toHaveLength(1);
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a timed-out worker and never dispatches its queued request', async () => {
    const transport = new FakeBuildWorkerTransport();
    const runtime = createWorkerPresentationBuildExecution({
      workerPath: '/slides/presentation-build-worker.cjs',
      requestTimeoutMs: 5,
      createTransport: () => transport,
    });

    const active = runtime.typecheckCodegenSource('active();');
    const queued = runtime.typecheckCodegenSource('queued();');
    const activeRejected = expect(active).rejects.toMatchObject({ kind: 'timeout' });
    const queuedRejected = expect(queued).rejects.toMatchObject({ kind: 'timeout' });
    transport.emitReady();
    await vi.waitFor(() => expect(transport.posted).toHaveLength(1));

    await activeRejected;
    await queuedRejected;
    expect(transport.posted).toHaveLength(1);
    expect(transport.terminate).toHaveBeenCalledOnce();
  });
});
