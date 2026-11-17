/** 首次实际分词才加载原生模块与词典；插件启用不能支付这项冷启动成本。 */
export async function tokenizeForSearch(text: string): Promise<string[]> {
  const { tokenizeWithJieba } = await import('src/shared/utils/tokenization');
  return tokenizeWithJieba(text);
}
