import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import { readBlockHistoryOriginLabel } from './blockHistoryPresentation';

const message: EditorMessageResolver = (key) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.blockHistory.origin.ai': 'AI 生成',
    'editor.blockHistory.origin.manual': '手动编辑',
    'editor.blockHistory.origin.restore': '版本恢复',
  };
  return messages[key] ?? key;
};

describe('blockHistoryPresentation', () => {
  it('解析来源标签', () => {
    expect(readBlockHistoryOriginLabel('restore', message)).toBe('版本恢复');
  });
});
