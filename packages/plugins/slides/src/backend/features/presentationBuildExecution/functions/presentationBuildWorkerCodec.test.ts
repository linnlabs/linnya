import { describe, expect, it } from 'vitest';
import { normalizeMathFormulaSource } from '@plugin/slides/shared';

import {
  PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES,
  PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT,
  PRESENTATION_BUILD_SOURCE_MAX_BYTES,
  PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
} from '../definitions/presentationBuildWorkerProtocol';
import {
  createPresentationBuildWorkerCompileComposeRequest,
  createPresentationBuildWorkerCompileComposeResultMessage,
  createPresentationBuildWorkerFailureMessage,
  createPresentationBuildWorkerMaterializeRequest,
  createPresentationBuildWorkerMaterializeResultMessage,
  createPresentationBuildWorkerTypecheckResultMessage,
  createPresentationBuildWorkerTypecheckRequest,
  parsePresentationBuildWorkerRequest,
  parsePresentationBuildWorkerResponse,
} from './presentationBuildWorkerCodec';

describe('presentationBuildWorkerCodec', () => {
  it('round-trips the strict typecheck request and result DTOs', () => {
    const request = createPresentationBuildWorkerTypecheckRequest({
      requestId: 'request-1',
      source: 'compose({ title: "Demo", slides: [] });',
    });
    expect(parsePresentationBuildWorkerRequest(request)).toEqual(request);

    expect(parsePresentationBuildWorkerResponse({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'typecheck_result',
      requestId: 'request-1',
      result: {
        ok: false,
        elapsedMs: 12,
        message: 'TS2304',
        records: [{
          line: 1,
          column: 1,
          code: 2304,
          category: 'error',
          message: 'Unknown global.',
          snippet: 'missingGlobal();',
        }],
      },
    })).toMatchObject({
      type: 'typecheck_result',
      result: { ok: false, records: [{ code: 2304 }] },
    });
  });

  it('rejects protocol drift, malformed diagnostics and oversized source', () => {
    expect(() => parsePresentationBuildWorkerResponse({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION + 1,
      type: 'ready',
    })).toThrow('protocol version mismatch');
    expect(() => parsePresentationBuildWorkerResponse({
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'typecheck_result',
      requestId: 'request-1',
      result: {
        ok: false,
        elapsedMs: 1,
        message: 'bad',
        records: [{
          line: 0,
          column: 1,
          code: 1,
          category: 'error',
          message: 'bad',
        }],
      },
    })).toThrow('diagnostic fields are invalid');
    expect(() => createPresentationBuildWorkerTypecheckRequest({
      requestId: 'request-1',
      source: 'x'.repeat(PRESENTATION_BUILD_SOURCE_MAX_BYTES + 1),
    })).toThrow('source exceeds');
  });

  it('bounds diagnostic payloads before they cross back into the App Server', () => {
    const result = createPresentationBuildWorkerTypecheckResultMessage({
      requestId: 'request-1',
      result: {
        ok: false,
        elapsedMs: 3,
        message: 'x'.repeat(40 * 1024),
        records: Array.from(
          { length: PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT + 10 },
          (_, index) => ({
            line: index + 1,
            column: 1,
            code: 2304,
            category: 'error' as const,
            message: 'm'.repeat(10 * 1024),
            snippet: 's'.repeat(1024),
          }),
        ),
      },
    });

    expect(result.result.records).toHaveLength(PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT);
    expect(result.result.message.endsWith('…')).toBe(true);
    expect(result.result.records[0]?.message.endsWith('…')).toBe(true);
    expect(result.result.records[0]?.snippet?.endsWith('…')).toBe(true);
    expect(parsePresentationBuildWorkerResponse(result)).toEqual(result);

    const failure = createPresentationBuildWorkerFailureMessage({
      requestId: 'request-failure-1',
      message: 'f'.repeat(40 * 1024),
      failure: { kind: 'execution' },
    });
    expect(failure.message.endsWith('…')).toBe(true);
    expect(parsePresentationBuildWorkerResponse(failure)).toEqual(failure);

    const formulaFailure = createPresentationBuildWorkerFailureMessage({
      requestId: 'request-formula-failure-1',
      message: 'Unsupported formula command.',
      failure: {
        kind: 'formula',
        code: 'slides.formula.unsupported_syntax',
      },
    });
    expect(parsePresentationBuildWorkerResponse(formulaFailure)).toEqual(formulaFailure);
  });

  it('round-trips bounded compose/layout DTOs and rejects oversized payloads', () => {
    const request = createPresentationBuildWorkerCompileComposeRequest({
      requestId: 'request-compose-1',
      payload: { title: 'Deck', slides: [] },
    });
    expect(parsePresentationBuildWorkerRequest(request)).toEqual(request);

    const response = createPresentationBuildWorkerCompileComposeResultMessage({
      requestId: request.requestId,
      result: { ok: true, input: request.payload },
    });
    expect(parsePresentationBuildWorkerResponse(response)).toEqual(response);

    expect(() => createPresentationBuildWorkerCompileComposeRequest({
      requestId: 'request-compose-large',
      payload: { source: 'x'.repeat(PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES) },
    })).toThrow('compose payload exceeds');
  });

  it('round-trips self-contained materialization DTOs and transferable PPTX results', () => {
    const blockFormula = normalizeMathFormulaSource({
      latex: String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
      altText: '一元二次方程求根公式',
    });
    const inlineFormula = normalizeMathFormulaSource({
      latex: 'E=mc^2',
      fontSize: 24,
      color: '#173B57',
      altText: '质能方程',
    }, 'inline');
    if ('error' in blockFormula || 'error' in inlineFormula) {
      throw new Error('Expected canonical formula fixtures.');
    }
    const request = createPresentationBuildWorkerMaterializeRequest({
      requestId: 'request-materialize-1',
      materialization: {
        deckSpec: {
          title: 'Deck',
          layout: '16x9',
          slides: [{
            slideNumber: 1,
            spec: {
              type: 'freeform',
              elements: [{
                type: 'text',
                position: { x: 1, y: 1, w: 3, h: 1 },
                content: [
                  { text: '能量关系 ' },
                  { formula: inlineFormula.value },
                ],
              }, {
                type: 'formula',
                position: { x: 1, y: 2, w: 3, h: 1 },
                source: blockFormula.value,
              }],
            },
          }],
        },
        svgAssets: [],
        svgFallbacks: [],
      },
    });
    expect(parsePresentationBuildWorkerRequest(request)).toEqual(request);

    const buffer = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer;
    const response = createPresentationBuildWorkerMaterializeResultMessage({
      requestId: request.requestId,
      buffer,
    });
    expect(parsePresentationBuildWorkerResponse(response)).toEqual(response);
  });

  it('round-trips a normalized custom canvas through the build worker codec', () => {
    const request = createPresentationBuildWorkerMaterializeRequest({
      requestId: 'request-custom-layout',
      materialization: {
        deckSpec: {
          title: 'Vertical Deck',
          layout: { width: 5.625, height: 10, unit: 'in' },
          slides: [{
            slideNumber: 1,
            spec: { type: 'freeform', elements: [] },
          }],
        },
        svgAssets: [],
        svgFallbacks: [],
      },
    });

    expect(parsePresentationBuildWorkerRequest(request)).toEqual(request);
  });

  it('rejects unresolved file paths before PPTX work reaches the Worker', () => {
    expect(() => createPresentationBuildWorkerMaterializeRequest({
      requestId: 'request-materialize-local-file',
      materialization: {
        deckSpec: {
          title: 'Deck',
          slides: [{
            slideNumber: 1,
            spec: {
              type: 'freeform',
              elements: [{
                type: 'image',
                position: { x: 1, y: 1, w: 3, h: 2 },
                src: { kind: 'local_path', path: '/tmp/image.png' },
              }],
            },
          }],
        },
        svgAssets: [],
        svgFallbacks: [],
      },
    })).toThrow('deck spec is invalid');
  });
});
