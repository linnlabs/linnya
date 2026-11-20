import type PptxGenJS from 'pptxgenjs';

/**
 * 作者 run（文本可含 `\n`）→ PptxGenJS 段落 run。
 *
 * PptxGenJS 自己拆 `\n` 时，把 run 的最后一截也标成段尾，换行后紧跟的 run（含行内公式占位）
 * 会被另起一段；它还为段内每个带段落属性的 run 各写一个 `a:pPr`。因此这里先拆好：
 * 文本不再含换行，段尾用显式 `breakLine`，`paragraphOptions` 只写在每段首个 run 上。
 * 空段用空 run 承载，保留字号；文本以换行结尾时保留末尾空段，与预览排版一致。
 */
export function splitPptxRunsIntoParagraphs(
  runs: readonly PptxGenJS.TextProps[],
  paragraphOptions: PptxGenJS.TextPropsOptions = {},
): PptxGenJS.TextProps[] {
  const result: PptxGenJS.TextProps[] = [];
  let paragraphOpen = false;
  let lastOptions: PptxGenJS.TextPropsOptions = {};

  const push = (text: string, options: PptxGenJS.TextPropsOptions): void => {
    result.push({
      text,
      options: { ...options, ...(paragraphOpen ? {} : paragraphOptions) },
    });
    paragraphOpen = true;
  };
  const endParagraph = (options: PptxGenJS.TextPropsOptions): void => {
    if (!paragraphOpen) push('', options);
    const last = result[result.length - 1];
    if (last) last.options = { ...last.options, breakLine: true };
    paragraphOpen = false;
  };

  for (const run of runs) {
    const options = run.options ?? {};
    lastOptions = options;
    const pieces = String(run.text ?? '').split(/\r?\n/);
    pieces.forEach((piece, index) => {
      if (index > 0) endParagraph(options);
      if (piece.length > 0) push(piece, options);
    });
  }
  if (!paragraphOpen) push('', lastOptions);
  return result;
}
