import { assertMarkdownDocument } from '../../../functions/assertMarkdownDocument';
import { workspaceMarkdownSchemaLite } from '../../workspace-schema';
import type { WorkspaceMarkdownPreviewInput, WorkspaceMarkdownPreviewSurface } from '../definitions/workspacePreview';
import { createWorkspacePreviewSerializer } from '../functions/createWorkspacePreviewSerializer';
import { workspaceListNumbers } from '../functions/workspaceListNumbers';
import { prepareWorkspacePreviewBlock, waitForPreviewResource } from './prepareWorkspacePreviewBlock';

/**
 * 首屏与详情使用同一渲染；按真实块高逐步准备，到相交块停止，绝不先渲染全部图表再裁切。
 * 临时测量节点只存在于本次调用，成功后移交结果，失败/取消立即释放。
 */
export async function createWorkspaceMarkdownPreview(input: WorkspaceMarkdownPreviewInput): Promise<WorkspaceMarkdownPreviewSurface> {
  input.signal.throwIfAborted();
  const json = input.content.document;
  // Pending 可以删除最后一个块；此空投影不回写、不放宽正式保存的 rootBlock+ 合同。
  const emptyProjection = json !== null && typeof json === 'object' && !Array.isArray(json)
    && json.type === 'doc' && Array.isArray(json.content) && json.content.length === 0
    && Object.keys(json).every(key => key === 'type' || key === 'content');
  if (!emptyProjection) assertMarkdownDocument(json, workspaceMarkdownSchemaLite);
  const node = emptyProjection ? workspaceMarkdownSchemaLite.topNodeType.create() : workspaceMarkdownSchemaLite.nodeFromJSON(json);
  const element = input.document.createElement('div');
  element.className = 'workspace-markdown-preview';
  element.setAttribute('data-linnya-ui-theme', input.theme);
  element.style.width = `${input.widthPx}px`;
  // 正文只读；链接保留外观和可复制目标，实际打开文档由统一预览外壳负责。
  element.addEventListener('click', event => event.preventDefault());
  const stage = input.document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  stage.append(element);
  input.document.body.append(stage);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    element.replaceChildren();
    element.remove();
    stage.remove();
    input.signal.removeEventListener('abort', dispose);
  };
  input.signal.addEventListener('abort', dispose, { once: true });
  try {
    const serializer = createWorkspacePreviewSerializer({ ...input, node, locale: input.locale ?? 'zh-CN' });
    const numbers = new Map(workspaceListNumbers(node).map(item => [item.rootPosition, item]));
    let position = 0;
    for (let index = 0; index < node.childCount; index++) {
      input.signal.throwIfAborted();
      const block = node.child(index);
      const rendered = serializer.serializeNode(block, { document: input.document });
      if (rendered.nodeType !== 1) throw new Error('preview_root_block_not_element');
      // serializeNode 已由本模块的根节点工厂保证 HTMLElement，跨 realm 用 ownerDocument 的类型检查。
      const blockElement = input.document.createElement('div');
      blockElement.className = 'workspace-preview-block';
      blockElement.append(rendered);
      const numbering = numbers.get(position);
      if (numbering) {
        const list = blockElement.querySelector('.list-item-block');
        list?.setAttribute('data-ordered-index', String(numbering.value));
      }
      element.append(blockElement);
      await prepareWorkspacePreviewBlock(block, blockElement, input);
      position += block.nodeSize;
      if (input.maxHeight !== undefined && element.getBoundingClientRect().height >= input.maxHeight) {
        element.style.maxHeight = `${input.maxHeight}px`;
        element.style.overflow = 'hidden';
        element.setAttribute('data-preview-clipped', String(index < node.childCount - 1 || element.scrollHeight > input.maxHeight));
        break;
      }
    }
    if (input.document.fonts) await waitForPreviewResource(input.document.fonts.ready, input.signal);
    input.signal.throwIfAborted();
    element.remove();
    stage.remove();
    return { element, dispose };
  } catch (failure) {
    dispose();
    throw failure;
  }
}
