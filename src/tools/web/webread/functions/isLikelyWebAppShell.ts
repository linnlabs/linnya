/**
 * 前端应用壳：可见正文稀少而脚本较多，正文通常要等应用取回数据后才出现。
 * 阈值与静态抽取的 js_shell 信号一致；渲染就绪只用可见文字（innerText），不把内联脚本算作正文。
 */
export const WEB_APP_SHELL_MAX_VISIBLE_TEXT_CHARS = 200;
export const WEB_APP_SHELL_MIN_SCRIPTS = 3;

export function isLikelyWebAppShell(facts: {
  readonly visibleTextLength: number;
  readonly scriptCount: number;
}): boolean {
  return facts.visibleTextLength < WEB_APP_SHELL_MAX_VISIBLE_TEXT_CHARS
    && facts.scriptCount >= WEB_APP_SHELL_MIN_SCRIPTS;
}
