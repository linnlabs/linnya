/** 沿用文档导出的文件名规则；Host 传入冻结文档名称，插件不读取当前编辑器。 */
export function knowledgeMarkdownFilename(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/[.\s]+$/g, '') || 'Untitled';
  return `${cleaned.replace(/\.[^/.]+$/u, '')}.md`;
}
