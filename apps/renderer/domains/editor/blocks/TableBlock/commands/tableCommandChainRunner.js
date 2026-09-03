/**
 * 表格 toolbar 命令链运行器。
 *
 * 中文说明：
 * - toolbar-facing wrapper 不能只靠“没抛异常”判断成功；
 * - Tiptap / ProseMirror 命令会通过 `chain().run()` 返回真实执行结果；
 * - 这里统一把返回语义收口，避免虚拟化 / selection 不满足时把失败误报成成功。
 */
export function runTableCommandChain(editor, label, buildCommand) {
  if (!editor || typeof editor.chain !== 'function') {
    console.warn(`[${label}] editor 或 editor.chain 不可用`);
    return false;
  }

  try {
    const chain = editor.chain().focus();
    const commandChain = buildCommand(chain);
    if (!commandChain || typeof commandChain.run !== 'function') {
      console.warn(`[${label}] 命令链未返回可运行对象`);
      return false;
    }

    return commandChain.run() === true;
  } catch (error) {
    console.error(`[${label}] 执行失败:`, error);
    return false;
  }
}
