import { createVNode, render, watch } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentReferencePresentation } from '@app/schemas';
import { useLocalizationStore } from '@app/localization';
import { documentReferenceGenericLabel, documentReferenceLabel } from '@linnya/markdown-document-core/references';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import type { RegisterEditorFocusPortal } from '@/domains/editor/shared/focus';
import { createHoverPreviewSchedule } from '@shared/hover-preview';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
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
  dom.append(icon, label);
  let iconType: string | null = null;
  let presentation: DocumentReferencePresentation | null = null;
  let destroyed = false;
  let refreshGeneration = 0;
  let popup: HTMLElement | null = null;
  // 浮层在准备阶段就挂进页面排首屏，但到露出时间且位置算好之前不可见（不可见的元素也不接收指针）。
  let revealed = false,
    positioned = false;
  let disposeDetail: (() => void) | undefined;
  let cancellation: AbortController | undefined;
  let releaseFocus: (() => void) | undefined;
  let stopPosition: (() => void) | undefined;
  function syncVisibility() {
    if (popup) popup.style.visibility = revealed && positioned ? 'visible' : 'hidden';
  }
  function close() {
    revealed = false;
    positioned = false;
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
  // 标签文字取自 markdown-document-core，与只读预览、画布卡片同一份，不在编辑器词条里另写一套；
  // 还没查到目标时先显示通用的“文档”。按当前界面语言显示，切换语言时重画。
  function paintLabel() {
    const locale = useLocalizationStore().currentLocale;
    label.textContent = presentation ? documentReferenceLabel(presentation, locale) : documentReferenceGenericLabel(locale);
    dom.setAttribute('aria-label', label.textContent);
  }
  async function refresh() {
    const generation = ++refreshGeneration;
    const result = await port.resolve(documentId);
    if (destroyed || generation !== refreshGeneration) return null;
    presentation = result;
    paintLabel();
    dom.dataset.status = result.status;
    // 与文件树同一类型图标；目标失效后不再声称类型，回到通用文档图标。
    const nodeType = result.status === 'deleted' || result.status === 'outside_project' ? null : result.nodeType;
    if (nodeType !== iconType) {
      iconType = nodeType;
      if (nodeType) port.renderIcon(nodeType, icon);
      else render(createVNode(DocumentIcon), icon);
    }
    return result;
  }
  // 准备阶段：读目标、建浮层、挂共用预览。此时浮层不可见，露出时机由 hover 时序决定。
  async function prepare() {
    const active = new AbortController();
    cancellation = active;
    const info = await refresh();
    if (!info || destroyed || active.signal.aborted) return;
    const panel = document.createElement('section');
    panel.className = 'document-reference-preview';
    panel.setAttribute('aria-label', resolveCurrentEditorMessage('editor.documentReference.preview.label'));
    // 预览正文不是可编辑区；点击段落/空白也要把焦点落在所属浮层，不能退到body。
    panel.tabIndex = -1;
    panel.style.visibility = 'hidden';
    panel.addEventListener('mouseenter', hover.stay);
    panel.addEventListener('mouseleave', hover.leave);
    document.body.append(panel);
    popup = panel;
    stopPosition = positionDocumentReferencePreview({
      reference: dom,
      panel,
      report: port.report,
      positioned() {
        positioned = true;
        syncVisibility();
      },
    });
    releaseFocus = registerFocusPortal?.(panel);
    try {
      // 浮层只管理定位与编辑焦点；首屏、展开、恢复和打开由共用预览拥有。
      const dispose = await port.mountPreview(documentId, panel, active.signal, hover.ready);
      if (destroyed || popup !== panel || active.signal.aborted) {
        dispose();
        return;
      }
      disposeDetail = dispose;
    } catch (failure) {
      if (active.signal.aborted) return;
      // 内部原因只进日志；浮层里给用户一句可读的提示，不显示原始报错。
      port.report(failure);
      if (popup === panel) {
        const notice = document.createElement('p');
        notice.className = 'document-reference-preview-notice';
        notice.setAttribute('role', 'status');
        notice.textContent = resolveCurrentEditorMessage('editor.documentReference.preview.failed');
        panel.append(notice);
        hover.ready();
      }
    }
  }
  const hover = createHoverPreviewSchedule({
    prepare() {
      void prepare().catch(port.report);
    },
    reveal() {
      revealed = true;
      syncVisibility();
    },
    close,
  });
  dom.addEventListener('mouseenter', () => hover.enter());
  dom.addEventListener('mouseleave', hover.leave);
  const open = () => {
    void refresh()
      .then(info => {
        if (!info) return;
        if (info.status === 'plugin_unavailable') return hover.enter(true);
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
    hover.close();
    void refresh().catch(port.report);
  });
  paintLabel();
  const stopLocaleWatch = watch(() => useLocalizationStore().currentLocale, paintLabel);
  void refresh().catch(port.report);
  return {
    dom,
    stopEvent: () => true,
    destroy() {
      destroyed = true;
      unsubscribe();
      stopLocaleWatch();
      hover.close();
      render(null, icon);
    },
  };
}
