import { createVNode, render, type Component } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentPreviewResult } from '@app/schemas';

/** 预览外壳自己的文字。语言缺省为 zh-CN，与 markdown-document-core 的预览同一约定；后台出图等不知道界面语言的消费方省略它。 */
export interface DocumentPreviewText {
  readonly status: Readonly<Record<DocumentPreviewResult['status'], string>>;
  /** 没有标题（目标已删除、在其他项目等）时的标题行。 */
  readonly unavailableTitle: string;
  readonly openLabel: (title: string) => string;
}
const chineseText: DocumentPreviewText = {
  status: {
    ready: '',
    deleted: '文档已删除',
    outside_project: '目标在其他项目，当前不可访问',
    plugin_unavailable: '需要启用或安装文档插件',
    preview_unavailable: '暂时没有可用预览',
  },
  unavailableTitle: '文档当前不可访问',
  openLabel: title => `打开文档：${title}`,
};
const englishText: DocumentPreviewText = {
  status: {
    ready: '',
    deleted: 'This document has been deleted',
    outside_project: 'This document is in another project and cannot be accessed right now',
    plugin_unavailable: 'Enable or install the document plugin to preview this document',
    preview_unavailable: 'No preview is available right now',
  },
  unavailableTitle: 'Document unavailable',
  openLabel: title => `Open document: ${title}`,
};
export function documentPreviewText(locale: string = 'zh-CN'): DocumentPreviewText {
  return locale.startsWith('zh') ? chineseText : englishText;
}
export function documentPreviewMessage(
  status: DocumentPreviewResult['status'],
  locale?: string
): string {
  return documentPreviewText(locale).status[status];
}
const iconTemplates = new WeakMap<Component, Node>();
/** 和文件树共用类型图标；静态位图与交互预览都从同一模板生成。 */
export function createDocumentPreviewIcon(
  document: Document,
  component: Component = DocumentIcon
): Node {
  let template = iconTemplates.get(component);
  if (!template) {
    const host = document.createElement('span');
    render(createVNode(component), host);
    const icon = host.querySelector('svg');
    if (!icon) throw new Error('Document preview type icon is missing');
    template = icon.cloneNode(true);
    render(null, host);
    iconTemplates.set(component, template);
  }
  return document.importNode(template, true);
}
