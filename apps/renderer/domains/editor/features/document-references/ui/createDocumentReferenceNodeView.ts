import { createVNode, render } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import type { RegisterEditorFocusPortal } from '@/domains/editor/shared/focus';
import { positionDocumentReferencePreview } from './positionDocumentReferencePreview';

/** DOM 仅展示与转发交互；身份和正文始终通过只读 port 解析。 */
export function createDocumentReferenceNodeView(
  documentId: string,
  referenceId: string,
  port: DocumentReferenceUiPort,
  registerFocusPortal?: RegisterEditorFocusPortal
) {
  const dom = document.createElement('span');
  dom.className = 'markdown-document-reference';
  dom.contentEditable = 'false';
  dom.tabIndex = 0;
  dom.setAttribute('role', 'link');
  dom.dataset.documentId = documentId;
  dom.dataset.referenceId = referenceId;
  const icon = document.createElement('span');
  icon.className = 'markdown-document-reference-icon';
  icon.dataset.documentReferenceIcon = '';
  icon.setAttribute('aria-hidden', 'true');
  render(createVNode(DocumentIcon), icon);
  const label = document.createElement('span');
  label.className = 'markdown-document-reference-label';
  label.dataset.documentReferenceLabel = '';
  label.textContent = '文档';
  dom.append(icon, label);
  let iconType: string | null = null;
  let destroyed = false;
  let hoverGeneration = 0;
  let refreshGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let popup: HTMLElement | null = null;
  let disposeDetail: (() => void) | undefined;
  let cancellation: AbortController | undefined;
  let releaseFocus: (() => void) | undefined;
  let stopPosition: (() => void) | undefined;
  function close() {
    if (timer) clearTimeout(timer);
    cancellation?.abort();
    cancellation = undefined;
    const release = releaseFocus,
      panel = popup,
      detail = disposeDetail,
      stop = stopPosition;
    releaseFocus = undefined;
    popup = null;
    disposeDetail = undefined;
    stopPosition = undefined;
    // 保存回调可以同步销毁NodeView；先交出资源，不能重入释放同一详情。
    stop?.();
    release?.();
    panel?.remove();
    detail?.();
  }
  async function refresh() {
    const generation = ++refreshGeneration;
    const result = await port.resolve(documentId);
    if (destroyed || generation !== refreshGeneration) return null;
    label.textContent =
      result.status === 'deleted'
        ? '已失效'
        : result.status === 'outside_project'
          ? '其他项目的文档'
          : (result.title ?? '文档');
    dom.dataset.status = result.status;
    dom.setAttribute('aria-label', label.textContent);
    // 与文件树同一类型图标；目标失效后不再声称类型，回到通用文档图标。
    const nodeType = result.status === 'deleted' || result.status === 'outside_project' ? null : result.nodeType;
    if (nodeType !== iconType) {
      iconType = nodeType;
      if (nodeType) port.renderIcon(nodeType, icon);
      else render(createVNode(DocumentIcon), icon);
    }
    return result;
  }
  async function show(generation: number) {
    const info = await refresh();
    if (!info || destroyed || generation !== hoverGeneration) return;
    close();
    const panel = document.createElement('section');
    panel.className = 'document-reference-preview';
    panel.setAttribute('aria-label', '文档预览');
    // 预览正文不是可编辑区；点击段落/空白也要把焦点落在所属浮层，不能退到body。
    panel.tabIndex = -1;
    panel.addEventListener('mouseenter', () => {
      if (timer) clearTimeout(timer);
    });
    panel.addEventListener('mouseleave', () => {
      timer = setTimeout(close, 200);
    });
    document.body.append(panel);
    popup = panel;
    stopPosition = positionDocumentReferencePreview({ reference: dom, panel, report: port.report });
    releaseFocus = registerFocusPortal?.(panel);
    const active = new AbortController();
    cancellation = active;
    try {
      // 浮层只管理定位与编辑焦点；首屏、展开、恢复和打开由共用预览拥有。
      const dispose = await port.mountPreview(documentId, panel, active.signal);
      if (destroyed || popup !== panel || active.signal.aborted) {
        dispose();
        return;
      }
      disposeDetail = dispose;
    } catch (failure) {
      if (!active.signal.aborted) port.report(failure);
    }
  }
  dom.addEventListener('mouseenter', () => {
    const generation = ++hoverGeneration;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void show(generation).catch(port.report);
    }, 400);
  });
  dom.addEventListener('mouseleave', () => {
    hoverGeneration += 1;
    if (timer) clearTimeout(timer);
    timer = setTimeout(close, 200);
  });
  const open = () => {
    void refresh()
      .then(info => {
        if (!info) return;
        if (info.status === 'plugin_unavailable') return show(++hoverGeneration);
        return port.open(info);
      })
      .catch(port.report);
  };
  dom.addEventListener('click', event => {
    event.preventDefault();
    open();
  });
  dom.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      open();
    }
  });
  const unsubscribe = port.subscribe(documentId, () => {
    hoverGeneration += 1;
    close();
    void refresh().catch(port.report);
  });
  void refresh().catch(port.report);
  return {
    dom,
    stopEvent: () => true,
    destroy() {
      destroyed = true;
      hoverGeneration += 1;
      unsubscribe();
      close();
      render(null, icon);
    },
  };
}
