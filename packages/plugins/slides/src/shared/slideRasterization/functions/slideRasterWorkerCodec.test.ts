import { describe, expect, it } from 'vitest';
import type { SlideRasterRequest } from '../definitions/slideRasterization';
import {
  createSlideRasterWorkerReadyPayload,
  createSlideRasterWorkerRequestPayload,
  createSlideRasterWorkerResponsePayload,
  parseSlideRasterWorkerReadyPayload,
  parseSlideRasterWorkerRequestPayload,
  parseSlideRasterWorkerResponsePayload,
} from './slideRasterWorkerCodec';
import { SLIDES_RASTER_WORKER_PROTOCOL_VERSION } from '../definitions/slideRasterWorkerProtocol';

function createRequest(): SlideRasterRequest {
  return {
    requestId: 'request-1',
    slide: {
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'structured',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [],
    },
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    profile: {
      id: 'agent-inspection-v1',
      viewportWidthPx: 1280,
      viewportHeightPx: 720,
      pixelRatio: 1,
      format: 'png',
      transparentBackground: true,
    },
  };
}

function createNestedRequest(): SlideRasterRequest {
  return {
    ...createRequest(),
    slide: {
      slideId: 'slide-nested',
      index: 1,
      layoutKey: 'dashboard',
      background: {
        paint: {
          type: 'linear',
          angle: 45,
          stops: [
            { color: '#FFFFFF', position: 0 },
            { color: '#000000', position: 1 },
          ],
        },
      },
      elements: [
        {
          id: 'text-1',
          kind: 'text',
          box: { x: 0, y: 0, w: 4, h: 1, unit: 'in' },
          zIndex: 0,
          paragraphs: [{
            runs: [{ text: 'Revenue', fontSize: 18, fontWeight: 'bold' }],
            align: 'center',
          }],
          layout: {
            lines: [{
              paragraphIndex: 0,
              slices: [{ paragraphIndex: 0, runIndex: 0, text: 'Revenue', x: 0, width: 1, textY: 0 }],
              y: 0,
              baseline: 0.2,
              height: 0.3,
              width: 1,
              align: 'center',
            }],
            contentHeightInches: 0.3,
            appliedFontScale: 1,
            appliedLineSpacingReduction: 0,
            advanceSource: 'pretext',
            overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
          },
        },
        {
          id: 'table-1',
          kind: 'table',
          box: { x: 0, y: 1, w: 4, h: 2, unit: 'in' },
          zIndex: 1,
          columns: [2, 2],
          rows: [1],
          cells: [{
            row: 0,
            col: 0,
            paragraphs: [{ runs: [{ text: 'Q1' }] }],
            borders: { bottom: { paint: { type: 'solid', color: '#000000' }, width: 1 } },
          }],
        },
        {
          id: 'chart-1',
          kind: 'chart',
          box: { x: 4, y: 1, w: 4, h: 2, unit: 'in' },
          zIndex: 2,
          chartType: 'column',
          categories: ['Q1'],
          series: [{ name: 'Revenue', values: [42] }],
          palette: ['#4472C4'],
          axes: { y: { visible: true, min: 0 } },
        },
      ],
    },
  };
}

describe('slide raster worker codec', () => {
  it('round-trips a valid request, response, and ready payload', () => {
    const request = createRequest();
    const requestPayload = createSlideRasterWorkerRequestPayload(request);
    expect(parseSlideRasterWorkerRequestPayload(requestPayload)).toEqual(requestPayload);

    const responsePayload = createSlideRasterWorkerResponsePayload({
      status: 'success',
      requestId: request.requestId,
      format: 'png',
      widthPx: 1280,
      heightPx: 720,
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(parseSlideRasterWorkerResponsePayload(responsePayload)).toEqual(responsePayload);

    const readyPayload = createSlideRasterWorkerReadyPayload();
    expect(parseSlideRasterWorkerReadyPayload(readyPayload)).toEqual(readyPayload);
  });

  it('rejects a non-boolean transparent background policy', () => {
    const valid = createSlideRasterWorkerRequestPayload(createRequest());
    expect(() => parseSlideRasterWorkerRequestPayload({
      ...valid,
      request: {
        ...valid.request,
        profile: {
          ...valid.request.profile,
          transparentBackground: 'yes',
        },
      },
    })).toThrow('request.profile.transparentBackground must be a boolean');
  });

  it('rejects protocol drift, unknown envelope fields, and mismatched request ids', () => {
    const valid = createSlideRasterWorkerRequestPayload(createRequest());

    expect(() => parseSlideRasterWorkerRequestPayload({
      ...valid,
      protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION + 1,
    })).toThrow('Unsupported slides raster worker protocol version');

    expect(() => parseSlideRasterWorkerRequestPayload({
      ...valid,
      unexpected: true,
    })).toThrow('Invalid slides raster worker request envelope');

    expect(() => parseSlideRasterWorkerRequestPayload({
      ...valid,
      requestId: 'other-request',
    })).toThrow('Slides raster worker request id mismatch');
  });

  it('rejects malformed response bytes instead of trusting the dynamic registry', () => {
    expect(() => parseSlideRasterWorkerResponsePayload({
      requestId: 'request-1',
      protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
      result: {
        status: 'success',
        requestId: 'request-1',
        format: 'png',
        widthPx: 1280,
        heightPx: 720,
        bytes: [137, 80, 78, 71],
      },
    })).toThrow('Invalid slide raster result bytes');
  });

  it('validates nested render-model fields before accepting a worker request', () => {
    const nested = createNestedRequest();
    expect(parseSlideRasterWorkerRequestPayload(
      createSlideRasterWorkerRequestPayload(nested),
    ).request).toEqual(nested);

    const validPayload = createSlideRasterWorkerRequestPayload(nested);
    const [text, table, chart] = nested.slide.elements;
    const invalidSlides: readonly unknown[] = [
      {
        ...nested.slide,
        background: {
          paint: {
            type: 'linear',
            angle: 45,
            stops: [{ color: '#FFFFFF', position: 'start' }],
          },
        },
      },
      {
        ...nested.slide,
        elements: [{
          ...text,
          paragraphs: [{ runs: [{ text: 42 }] }],
        }],
      },
      {
        ...nested.slide,
        elements: [{
          ...table,
          cells: [{ row: 0, col: 0, paragraphs: 'Q1' }],
        }],
      },
      {
        ...nested.slide,
        elements: [{
          ...chart,
          series: [{ name: 'Revenue', values: ['42'] }],
        }],
      },
    ];

    for (const slide of invalidSlides) {
      expect(() => parseSlideRasterWorkerRequestPayload({
        ...validPayload,
        request: {
          ...validPayload.request,
          slide,
        },
      })).toThrow('Invalid slide raster request slide');
    }
  });
});
