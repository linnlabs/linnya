import { createVNode, render, type Component } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentPreviewResult } from '@app/schemas';

const statusMessages: Record<DocumentPreviewResult['status'], string> = {
  ready: '', deleted: '文档已删除', outside_project: '目标在其他项目，当前不可访问',
  plugin_unavailable: '需要启用或安装文档插件', preview_unavailable: '暂时没有可用预览',
};
export function documentPreviewMessage(status: DocumentPreviewResult['status']): string {
  return statusMessages[status];
}
const iconTemplates = new WeakMap<Component, Node>();
/** 和文件树共用类型图标；静态位图与交互预览都从同一模板生成。 */
export function createDocumentPreviewIcon(document: Document, component: Component = DocumentIcon): Node {
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
