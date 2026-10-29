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
  it('批量、新对象和图片修改严格接纳作者值，拒绝嵌套事务或任意属性', () => {
    const base = { commandId: 'c8356051-a487-4cd3-863f-47db0079f991', documentId: 'deck',
      expectedBase: { revisionId: 'v1', revision: 1, sourceHash: 'a'.repeat(64) } };
    const target = { slideKey: 'page', editKey: 'title' };
    const move = { op: 'translate_by', target, targetKind: 'text', delta: { dx: 1 / 96, dy: 0 } };
    const parse = (operation: unknown) => parseSlidesManualEditPayload({ ...base, operation }).operation;
    expect(parse({ op: 'batch', operations: [move] })).toEqual({ op: 'batch', operations: [move] });
    expect(() => parse({ op: 'batch', operations: [{ op: 'undo' }] })).toThrow();
    expect(() => parse({ op: 'batch', operations: [{ op: 'batch', operations: [move] }] })).toThrow();
    expect(() => parse({ op: 'batch', operations: [] })).toThrow();
    expect(parse({ op: 'set_image', target, targetKind: 'image', assetId: 'owned-image', fit: 'cover' })).toMatchObject({ assetId: 'owned-image' });
    expect(() => parse({ op: 'set_image', target, targetKind: 'image', src: 'https://example.com/image.png' })).toThrow();
    const object = { kind: 'text', editKey: 'new-title', content: [{ text: 'Title', style: { bold: true } }], style: { fontSize: 24 }, box: { x: 1, y: 1, w: 3, h: 1 } };
    expect(parse({ op: 'insert_objects', index: 0, objects: [object] })).toMatchObject({ objects: [object] });
    expect(() => parse({ op: 'insert_objects', index: 0, objects: [object, object] })).toThrow();
    expect(() => parse({ op: 'insert_objects', index: 0, objects: [{ ...object, html: '<b>Title</b>' }] })).toThrow();
    expect(() => parse({ op: 'set_text_width', target, targetKind: 'text', width: 0 })).toThrow();
  });
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
    const richOperation = { op: 'set_text_content', target: payload.operation.target, targetKind: 'text',
      content: [{ text: 'A', style: { fontSize: 28, color: '#112233', bold: true } }, { text: '\nB' }] };
    expect(parseSlidesManualEditPayload({ ...payload, operation: richOperation }).operation).toEqual(richOperation);
    expect(() => parseSlidesManualEditPayload({ ...payload, operation: { ...richOperation, targetKind: 'shape' } })).toThrow();
    for (const content of [[{ formula: 'x' }], [{ text: 'A', style: { fontSize: Infinity } }], [{ text: 'A', style: { unknown: true } }]]) {
      expect(() => parseSlidesManualEditPayload({ ...payload, operation: { ...richOperation, content } })).toThrow();
    }


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

    const resizeOperation = { op: 'set_visual_size', target: payload.operation.target,
      targetKind: 'shape', visualSize: { width: 3, height: 1.5 }, translationDelta: { dx: -1, dy: -0.5 } };
    expect(parseSlidesManualEditPayload({ ...payload, operation: resizeOperation }).operation).toEqual(resizeOperation);
    for (const translationDelta of [{ dx: Infinity, dy: 0 }, { dx: 0 }, { dx: 0, dy: 0, extra: true }, null]) {
      expect(() => parseSlidesManualEditPayload({ ...payload, operation: { ...resizeOperation, translationDelta } })).toThrow();
    }

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

    for (const op of ['insert_blank_slide', 'duplicate_slide', 'delete_slide']) {
      const operation = { op, index: 2 };
      expect(parseSlidesManualEditPayload({ ...payload, operation }).operation).toEqual(operation);
      expect(() => parseSlidesManualEditPayload({ ...payload, operation: { op, index: -1 } })).toThrow();
      expect(() => parseSlidesManualEditPayload({ ...payload, operation: { op, index: 0, target: payload.operation.target } })).toThrow();
    }
    for (const operation of [
      { op: 'insert_blank_slide', index: -1 },
      { op: 'insert_blank_slide', index: 1.5 },
      { op: 'insert_blank_slide' },
      { op: 'insert_blank_slide', index: 1, target: payload.operation.target },
    ]) {
      expect(() => parseSlidesManualEditPayload({ ...payload, operation })).toThrow();
    }

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
