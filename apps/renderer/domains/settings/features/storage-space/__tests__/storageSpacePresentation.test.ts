import { describe, expect, it } from 'vitest';

import { formatStorageBytes } from '../functions/formatStorageBytes';
import { projectStorageConversationTitle } from '../functions/projectStorageConversationTitle';

describe('storage-space presentation', () => {
  it('空标题统一显示本地化的未命名文案，非空标题只清理首尾空白', () => {
    expect(projectStorageConversationTitle('', '未命名对话')).toBe('未命名对话');
    expect(projectStorageConversationTitle('   ', '未命名对话')).toBe('未命名对话');
    expect(projectStorageConversationTitle('  季度报告  ', '未命名对话')).toBe('季度报告');
  });

  it('以稳定单位展示常见存储大小', () => {
    expect(formatStorageBytes(0, 'zh-CN')).toBe('0 B');
    expect(formatStorageBytes(1536, 'en-US')).toBe('1.5 KB');
  });
});
