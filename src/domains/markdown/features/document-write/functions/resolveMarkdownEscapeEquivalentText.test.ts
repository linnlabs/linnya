import { describe, expect, it } from 'vitest';
import { resolveMarkdownEscapeEquivalentText as resolve } from './resolveMarkdownEscapeEquivalentText';

describe('Markdown escape-equivalent edit target', () => {
  it('locates a unique redundant escape spelling without changing any whitespace', async () => {
    expect(
      await resolve({
        source: 'Clause 202\\(c\\) is relevant.\n\nNext.',
        oldString: 'Clause 202(c) is relevant.',
      })
    ).toBe('Clause 202\\(c\\) is relevant.');
    expect(
      await resolve({
        source: 'Clause 202(c) is relevant.',
        oldString: 'Clause 202\\(c\\) is relevant.',
      })
    ).toBe('Clause 202(c) is relevant.');
  });
  it('rejects ambiguity, including when the caller might use replace_all', async () => {
    await expect(
      resolve({ source: '202\\(c\\)\n\n202(c)', oldString: '202\\(c)' })
    ).rejects.toThrow(/not unique.*candidate lines: 1, 3.*Current excerpts:/);
  });
  it.each([
    ['literal \\*important\\* here', 'literal *important* here'],
    ['`202\\(c\\)`', '`202(c)`'],
    ['```text\n202\\(c\\)\n```', '202(c)'],
    ['text \\[@ABC234]', 'text [@ABC234]'],
    ['text [@ABC234]', 'text \\[@ABC234]'],
    ['\\# plain heading', '# plain heading'],
    ['two  spaces', 'two spaces'],
    ['- first\n\n- second', '- first\n- second'],
    ['1. first', '2. first'],
  ])('does not silently change Markdown meaning: %s', async (source, oldString) => {
    expect(await resolve({ source, oldString })).toBeNull();
  });
});
