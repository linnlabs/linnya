import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  READING_FONT_SIZE_PX,
  READING_HEADING_SCALE,
  READING_LINE_HEIGHT_PX,
  readingEm,
  readingHeadingFontSizePx,
} from './conversationReadingTypography';

const repoRoot = resolve(__dirname, '../../../../../../..');
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8');

describe('conversation reading typography', () => {
  it('估高常量与 renderer-ui 的 prose 字阶 token 一致', () => {
    const tokens = read('packages/renderer-ui/src/styles/tokens/typography.css');
    expect(tokens).toContain(`--font-size-sm: ${READING_FONT_SIZE_PX}px;`);
    expect(tokens).toContain('--font-size-prose: var(--font-size-sm);');
    expect(tokens).toContain(`--line-height-prose: ${READING_LINE_HEIGHT_PX}px;`);
  });

  it('回答、用户消息与输入框都使用 prose 字阶', () => {
    for (const file of [
      'apps/renderer/domains/conversation/styles/components/AnswerMessage.css',
      'apps/renderer/domains/conversation/styles/components/UserMessage.css',
      'apps/renderer/domains/conversation/styles/components/AiAssistantInput.css',
    ]) {
      const css = read(file);
      expect(css, file).toContain('var(--font-size-prose)');
      expect(css, file).toContain('var(--line-height-prose)');
    }
  });

  it('标题字号倍数与 markdown 样式里的 em 一致', () => {
    const css = read('apps/renderer/domains/conversation/styles/features/markstream-conversation-message.css');
    for (const [level, scale] of Object.entries(READING_HEADING_SCALE)) {
      const rule = new RegExp(`h${level} \\{\\s*font-size: ${scale}em;`);
      expect(css).toMatch(rule);
    }
  });

  it('em 换算与标题字号', () => {
    expect(readingEm(0.5)).toBe(7);
    expect(readingEm(1.1, 18)).toBe(20);
    expect(readingHeadingFontSizePx(1)).toBe(20);
    expect(readingHeadingFontSizePx(2)).toBe(17);
    expect(readingHeadingFontSizePx(3)).toBe(15);
    expect(readingHeadingFontSizePx(5)).toBe(14);
  });
});
