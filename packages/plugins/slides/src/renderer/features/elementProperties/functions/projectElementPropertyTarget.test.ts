import { wholeTextStyle } from '@plugin/slides/shared/authoringEditing';
import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget, ManualEditingVisualPreview } from '../../manualEditing';
import { projectElementPropertyTarget } from './projectElementPropertyTarget';

describe('effective element property values', () => {
  it('combines pending font size with queued color, ignores other targets, and rolls back together', () => {
    const authoringRef = { slideKey: 'slide', editKey: 'title' };
    const target: ManualEditableTarget = {
      elementId: 'title', nodeKind: 'text', targetKind: 'text',
      capabilities: ['set_text_style'], authoringRef, authoringAncestorRefs: [],
      bounds: { x: 0, y: 0, w: 2, h: 1 }, polygon: [], translationElementIds: ['title'],
      textEditing: {
        elementId: 'title', targetKind: 'text', authoringRef, content: 'Hello', origin: { x: 0, y: 0 },
        width: 2, height: 1, rotation: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 },
        verticalOffset: 0, fontFamily: 'Arial', fontSizePt: 24, appliedFontScale: 1,
        fontWeight: 'normal', fontStyle: 'normal', color: '#2563EB', textAlign: 'left', lineHeight: 1, opacity: 1,
      },
    };
    const previews: readonly ManualEditingVisualPreview[] = [
      { elementId: 'title', affectedElementIds: ['title'], operation: { op: 'set_text_style', target: authoringRef, fontSizePt: 36 } },
      { elementId: 'title', affectedElementIds: ['title'], operation: { op: 'set_text_style', target: authoringRef, color: '#123456' } },
      { elementId: 'other', affectedElementIds: ['other'], operation: { op: 'set_text_style', target: { ...authoringRef, editKey: 'other' }, color: '#FFFFFF' } },
    ];
    expect(projectElementPropertyTarget(target, previews).textEditing).toMatchObject({ fontSizePt: 36, color: '#123456', content: 'Hello' });
    expect(projectElementPropertyTarget(target, []).textEditing).toMatchObject({ fontSizePt: 24, color: '#2563EB' });
    const pendingContent = [{ text: 'Hello', style: { color: '#DC2626' } }];
    const pending = projectElementPropertyTarget(target, [], pendingContent);
    expect(pending.capabilities).toContain('set_text_style');
    expect(pending.textEditing?.content).toEqual(pendingContent);
    const rich = [{ text: 'Hel', style: { bold: true } }, { text: 'lo', style: { color: '#DC2626', fontSize: 28 } }];
    const contentPreview: ManualEditingVisualPreview = { elementId: 'title', affectedElementIds: ['title'],
      operation: { op: 'set_text_content', targetKind: 'text', target: authoringRef, content: rich } };
    const wholePreview: ManualEditingVisualPreview = { ...contentPreview,
      operation: { op: 'set_text_style', target: authoringRef, fontSizePt: 32, color: '#2563EB' } };
    const localPreview: ManualEditingVisualPreview = { ...contentPreview,
      operation: { op: 'set_text_content', targetKind: 'text', target: authoringRef,
        content: [{ text: 'Hel', style: { bold: true, fontSize: 32, color: '#2563EB' } },
          { text: 'lo', style: { fontSize: 20, color: '#2563EB' } }] } };
    const mixed = projectElementPropertyTarget(target, [contentPreview]).textEditing;
    const whole = projectElementPropertyTarget(target, [contentPreview, wholePreview]).textEditing;
    const local = projectElementPropertyTarget(target, [contentPreview, wholePreview, localPreview]).textEditing;
    if (!mixed || !whole || !local) throw new Error('Missing text properties');
    expect(wholeTextStyle(mixed.content, mixed)).toEqual({ fontSizePt: null, color: null });
    expect(wholeTextStyle(whole.content, whole)).toEqual({ fontSizePt: 32, color: '#2563EB' });
    expect(wholeTextStyle(local.content, local)).toEqual({ fontSizePt: null, color: '#2563EB' });
    expect(local.content).toEqual(localPreview.operation.op === 'set_text_content' ? localPreview.operation.content : undefined);
    expect(projectElementPropertyTarget(target, []).capabilities).toContain('set_text_style');
  });
});
