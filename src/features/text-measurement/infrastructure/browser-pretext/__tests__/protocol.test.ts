import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  createMeasurementBatchRequest,
  createMeasurementBatchResponse,
  createMeasurementWorkerReadyPayload,
  parseMeasurementBatchRequest,
  parseMeasurementBatchResponse,
  parseMeasurementWorkerReadyPayload,
} from '../protocol.js';

const sampleInput = {
  paragraphs: [
    {
      text: 'Quarterly business review highlights',
      indentInches: 0,
      spacingBeforePt: 0,
      spacingAfterPt: 0,
    },
  ],
  style: {
    fontFamily: 'Arial',
    fontSizePt: 12,
    lineHeightMultiplier: 1.2,
    bold: false,
    italic: false,
    letterSpacingPt: 0,
  },
  box: {
    widthInches: 3.2,
    heightInches: 1.0,
    wrap: 'word' as const,
    padding: {
      top: 0.05,
      right: 0.05,
      bottom: 0.05,
      left: 0.05,
    },
    usableWidthInches: 3.1,
    usableHeightInches: 0.9,
  },
  sourceKind: 'generated' as const,
};

describe('measurement protocol', () => {
  it('round-trips a batch request payload', () => {
    const request = createMeasurementBatchRequest([sampleInput], 'req-1');

    expect(parseMeasurementBatchRequest(request)).toEqual({
      requestId: 'req-1',
      protocolVersion: PROTOCOL_VERSION,
      inputs: [sampleInput],
    });
  });

  it('round-trips a batch response payload', () => {
    const response = createMeasurementBatchResponse('req-1', [
      {
        lineCount: 2,
        contentHeightInches: 0.33,
        totalHeightInches: 0.43,
        maxLineWidthInches: 2.8,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
      {
        error: 'pretext unavailable',
      },
    ]);

    expect(parseMeasurementBatchResponse(response)).toEqual({
      requestId: 'req-1',
      protocolVersion: PROTOCOL_VERSION,
      results: [
        {
          lineCount: 2,
          contentHeightInches: 0.33,
          totalHeightInches: 0.43,
          maxLineWidthInches: 2.8,
          usedFallback: false,
          warnings: [],
          fitsWidth: true,
          fitsHeight: true,
        },
        {
          error: 'pretext unavailable',
        },
      ],
    });
  });

  it('parses worker ready payloads', () => {
    const payload = createMeasurementWorkerReadyPayload();

    expect(parseMeasurementWorkerReadyPayload(payload)).toEqual({
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('rejects malformed request payloads', () => {
    expect(() => parseMeasurementBatchRequest({
      requestId: '',
      protocolVersion: PROTOCOL_VERSION,
      inputs: [],
    })).toThrow(/requestId/i);
  });

  it('rejects malformed response payloads', () => {
    expect(() => parseMeasurementBatchResponse({
      requestId: 'req-1',
      protocolVersion: PROTOCOL_VERSION,
      results: [
        {
          lineCount: '2',
        },
      ],
    })).toThrow();
  });
});
