/** 中文是源文案，英文必须给出同一组键；漏一个键类型检查就不过。 */
export function defineCanvasMessages<const Zh extends Readonly<Record<string, string>>>(
  zh: Zh,
  en: Readonly<Record<keyof Zh, string>>
): { readonly zh: Zh; readonly en: Readonly<Record<keyof Zh, string>> } {
  return { zh, en };
}
