import { convertToHeading, setBaseBlock } from '../extensions/core/commands/ConversionCommands';

/**
 * 把光标所在块设为某级标题；level 为 null 时转回正文。Markdown 命令条与选区工具条共用。
 *
 * @param {import('@tiptap/core').Editor} editor
 * @param {number | null} level
 */
export function applyHeadingLevel(editor, level) {
  const command = level === null ? setBaseBlock() : convertToHeading(level);
  command({ state: editor.state, dispatch: editor.view.dispatch });
  editor.commands.focus();
}
