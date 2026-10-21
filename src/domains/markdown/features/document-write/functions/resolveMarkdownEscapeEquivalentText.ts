import { importMarkdownToDocJson } from '../../normalization/importMarkdownToDocJson';
import type { ProseMirrorJsonNode } from '../../normalization/types';

interface EscapeProjection {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/** 只去掉 CommonMark 允许的 ASCII 标点转义；不合并空白、列表或任何文字。 */
function projectEscapes(text: string): EscapeProjection {
  let projected = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const start = index;
    if (text[index] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[index + 1] ?? '')) {
      index += 1;
    }
    projected += text[index];
    starts.push(start);
    ends.push(index + 1);
  }
  return { text: projected, starts, ends };
}

/** 解析器按转义处分割 text node，PM 规范化合并后再比较；仅忽略临时块身份。 */
function semantics(node: ProseMirrorJsonNode | null): unknown {
  return node && {
    type: node.type, text: node.text, marks: node.marks,
    attrs: node.attrs && Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'id')),
    content: node.content?.map(semantics),
  };
}

/**
 * exact 失败后的窄匹配：候选范围唯一，而且把该范围改成 old_string 的另一种拼写后，
 * 整篇重新解析的块/marks/代码/属性完全相同。这样 `\*x\*` 不会被当成强调 `*x*`，
 * 代码里的反斜杠也不会被吞掉。Citation token 是额外领域语法，含它的拼写差异不代猜。
 */
export async function resolveMarkdownEscapeEquivalentText(params: {
  readonly source: string;
  readonly oldString: string;
}): Promise<string | null> {
  const source = projectEscapes(params.source);
  const old = projectEscapes(params.oldString).text;
  if (!old) return null;
  const offsets: number[] = [];
  for (let offset = source.text.indexOf(old); offset !== -1; offset = source.text.indexOf(old, offset + 1)) {
    offsets.push(offset);
    if (offsets.length === 6) break;
  }
  if (offsets.length === 0) return null;
  if (offsets.length > 1) {
    const lines = offsets.map(offset => params.source.slice(0, source.starts[offset]).split('\n').length);
    throw new Error(`Markdown escape-equivalent old_string is not unique (candidate lines: ${lines.join(', ')}). Copy a larger exact block from read_file; replace_all does not apply to equivalent matches.`);
  }
  const start = source.starts[offsets[0]];
  const end = source.ends[offsets[0] + old.length - 1];
  const candidate = params.source.slice(start, end);
  if (candidate === params.oldString || /\\?\[@/.test(candidate) || /\\?\[@/.test(params.oldString)) return null;
  const alternate = params.source.slice(0, start) + params.oldString + params.source.slice(end);
  const [before, after] = await Promise.all([
    importMarkdownToDocJson(params.source),
    importMarkdownToDocJson(alternate),
  ]);
  if (!before.docJson || !after.docJson) return null;
  return JSON.stringify(semantics(before.docJson)) === JSON.stringify(semantics(after.docJson))
    ? candidate : null;
}
