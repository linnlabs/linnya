import { describe, expect, it } from 'vitest';
import {
  SLIDES_IPC as PACKAGE_SLIDES_IPC,
  SLIDES_IPC_CHANNELS as PACKAGE_SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID as PACKAGE_SLIDES_PLUGIN_ID,
} from '@plugin/slides/shared';
import {
  parseSlidesSourceSlicesPayload,
  parseSlidesManualEditPayload,
  parseSlidesTemplateImportPayload,
  SLIDES_IPC,
  SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID,
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
} from './index';

describe('slides backend IPC contracts', () => {
  it('re-exports package-owned Slides IPC identity', () => {
    expect(SLIDES_PLUGIN_ID).toBe(PACKAGE_SLIDES_PLUGIN_ID);
    expect(SLIDES_IPC).toBe(PACKAGE_SLIDES_IPC);
    expect(SLIDES_IPC_CHANNELS).toBe(PACKAGE_SLIDES_IPC_CHANNELS);
  });

  it('keeps direct PPTX document import paused while allowing template import', () => {
    const channels: readonly string[] = [...SLIDES_IPC_CHANNELS];

    expect(channels).toContain('slides:template-import');
    expect(channels).not.toContain('slides:import');
    expect(channels).not.toContain('slides:pptx-import');
    expect(channels).not.toContain('slides:generate');
    expect(channels).not.toContain('slides:patch');
    expect(Object.keys(SLIDES_IPC)).not.toContain('import');
  });

  it('accepts source slice targets but rejects empty target lists', () => {
    const target = {
      elementId: 'element-1',
      slideNumber: 1,
      kind: 'text',
      sourceSpan: {
        startLine: 3,
        endLine: 5,
      },
    };

    expect(parseSlidesSourceSlicesPayload({
      nodeId: 'presentation-1',
      conversationId: 'conversation-1',
      targets: [target],
    })).toEqual({
      nodeId: 'presentation-1',
      conversationId: 'conversation-1',
      targets: [target],
    });

    expect(() => parseSlidesSourceSlicesPayload({
      nodeId: 'presentation-1',
      conversationId: 'conversation-1',
      targets: [],
    })).toThrow('targets must contain valid source slice targets.');
  });

  it('normalizes template import binary payloads to Buffer', () => {
    const input = Uint8Array.from([1, 2, 3]);

    const parsed = parseSlidesTemplateImportPayload({
      fileName: 'template.pptx',
      name: 'Template',
      description: 'demo',
      buffer: input,
    });

    expect(parsed).toMatchObject({
      fileName: 'template.pptx',
      name: 'Template',
      description: 'demo',
    });
    expect(Buffer.compare(parsed.buffer, Buffer.from([1, 2, 3]))).toBe(0);
  });

  it('strictly parses the version snapshot and supported manual edit operations', () => {
    const payload = {
      commandId: 'c8356051-a487-4cd3-863f-47db0079f991',
      documentId: 'presentation-1',
      expectedBase: {
        revisionId: 'revision-1',
        revision: 1,
        sourceHash: 'a'.repeat(64),
      },
      operation: {
        op: 'set_translation',
        target: { slideKey: 'overview', editKey: 'headline' },
        targetKind: 'text',
        translation: { dx: 0.25, dy: -0.1 },
      },
    };
    expect(parseSlidesManualEditPayload(payload)).toEqual(payload);

    expect(parseSlidesManualEditPayload({
      ...payload,
      operation: {
        op: 'translate_by',
        target: payload.operation.target,
        targetKind: 'image',
        delta: { dx: -0.2, dy: 0.4 },
      },
    })).toMatchObject({
      operation: { op: 'translate_by', targetKind: 'image', delta: { dx: -0.2, dy: 0.4 } },
    });

    expect(parseSlidesManualEditPayload({
      ...payload,
      operation: {
        op: 'set_text_style',
        target: payload.operation.target,
        fontSizePt: 28,
        color: '#123456',
      },
    })).toMatchObject({
      operation: { op: 'set_text_style', fontSizePt: 28, color: '#123456' },
    });

    expect(parseSlidesManualEditPayload({
      ...payload,
      operation: {
        op: 'set_visual_size',
        target: payload.operation.target,
        targetKind: 'shape',
        visualSize: { width: 3, height: 1.5 },
      },
    })).toMatchObject({
      operation: {
        op: 'set_visual_size', targetKind: 'shape', visualSize: { width: 3, height: 1.5 },
      },
    });

    expect(parseSlidesManualEditPayload({
      ...payload,
      operation: {
        op: 'delete_target',
        target: payload.operation.target,
        targetKind: 'frame',
      },
    })).toMatchObject({ operation: { op: 'delete_target', targetKind: 'frame' } });

    expect(parseSlidesManualEditPayload({
      ...payload,
      operation: {
        op: 'delete_target',
        target: payload.operation.target,
        targetKind: 'image',
      },
    })).toMatchObject({ operation: { op: 'delete_target', targetKind: 'image' } });

    expect(() => parseSlidesManualEditPayload({
      ...payload,
      expectedBase: { ...payload.expectedBase, sourceHash: 'not-a-hash' },
    })).toThrow('lowercase SHA-256');
    expect(() => parseSlidesManualEditPayload({
      ...payload,
      operation: { ...payload.operation, ignored: true },
    })).toThrow('unknown field ignored');
  });

  it('enforces a template upload size limit before importing PPTX content', () => {
    expect(() => parseSlidesTemplateImportPayload({
      fileName: 'too-large.pptx',
      name: 'Too Large',
      buffer: new ArrayBuffer(SLIDES_TEMPLATE_IMPORT_MAX_BYTES + 1),
    })).toThrow(`PPTX file is too large. Maximum size is ${SLIDES_TEMPLATE_IMPORT_MAX_BYTES} bytes.`);
  });
});
