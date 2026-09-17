import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { textContentToDocument, documentToTextContent, patchSelectedTextStyle, selectedTextStyle } from './richTextDocument';
import { isEditableTextContent } from '@plugin/slides/shared/authoringEditing';

describe('author text selection editing', () => {
  it('preserves author styles and line breaks while changing only a selected range, including undo/redo', () => {
    const content = [{ text: 'Revenue ', style: { bold: true, fontFamily: 'Inter', letterSpacing: 0.5 } },
      { text: '30%\n中文🙂', style: { color: '#335577', fontSize: 18, italic: true } }];
    const doc = textContentToDocument(content);
    expect(documentToTextContent(doc)).toEqual(content);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 9, 12), plugins: [history()] });
    state = state.apply(patchSelectedTextStyle(state, { fontSizePt: 28, color: '#E11D48' }));
    const edited = documentToTextContent(state.doc);
    expect(edited).toEqual([content[0], { text: '30%', style: { ...content[1].style, fontSize: 28, color: '#E11D48' } },
      { text: '\n中文🙂', style: content[1].style }]);
    expect(isEditableTextContent(edited)).toBe(true);
    expect(selectedTextStyle(state, { fontSizePt: 14, color: '#000000' })).toEqual({ fontSizePt: 28, color: '#E11D48' });
    undo(state, tr => { state = state.apply(tr); });
    expect(documentToTextContent(state.doc)).toEqual(content);
    redo(state, tr => { state = state.apply(tr); });
    expect(documentToTextContent(state.doc)).toEqual(edited);
  });
  it('reports mixed formatting and roundtrips leading/trailing empty lines without HTML state', () => {
    const content = [{ text: '\nA', style: { color: '#FF0000', fontSize: 20 } }, { text: '\nB\n' }];
    const doc = textContentToDocument(content);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
    expect(documentToTextContent(doc)).toEqual(content);
    expect(selectedTextStyle(state, { fontSizePt: 14, color: '#000000' })).toEqual({ fontSizePt: null, color: null });
    expect(documentToTextContent(textContentToDocument(''))).toBe('');
  });
});
