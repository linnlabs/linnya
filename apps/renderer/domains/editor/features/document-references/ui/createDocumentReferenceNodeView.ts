import { createVNode, render } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';

/** DOM 仅展示与转发交互；身份和正文始终通过只读 port 解析。 */
export function createDocumentReferenceNodeView(documentId: string, referenceId: string, port: DocumentReferenceUiPort) {
  const dom = document.createElement('span');
  dom.className = 'markdown-document-reference';
  dom.contentEditable = 'false';
  dom.tabIndex = 0;
  dom.setAttribute('role', 'link');
  dom.dataset.documentId = documentId;
  dom.dataset.referenceId = referenceId;
  const icon = document.createElement('span'); icon.className = 'markdown-document-reference-icon'; icon.dataset.documentReferenceIcon = ''; icon.setAttribute('aria-hidden', 'true');
  render(createVNode(DocumentIcon), icon);
  const label = document.createElement('span'); label.className = 'markdown-document-reference-label'; label.dataset.documentReferenceLabel = ''; label.textContent = '文档'; dom.append(icon, label);
  let destroyed = false;
  let hoverGeneration = 0;
  let refreshGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let popup: HTMLElement | null = null;
  let disposeDetail: (() => void) | undefined;
  function close() { if (timer) clearTimeout(timer); popup?.remove(); popup = null; disposeDetail?.(); disposeDetail = undefined; }
  async function refresh() {
    const generation = ++refreshGeneration;
    const result = await port.resolve(documentId);
    if (destroyed || generation !== refreshGeneration) return null;
    label.textContent = result.status === 'deleted' ? '已失效' : result.status === 'outside_project' ? '其他项目的文档' : result.title ?? '文档';
    dom.dataset.status = result.status;
    dom.setAttribute('aria-label', label.textContent);
    return result;
  }
  async function show(generation: number) {
    const info = await refresh();
    if (!info || destroyed || generation !== hoverGeneration) return;
    close();
    const panel = document.createElement('section');
    panel.className = 'document-reference-preview'; panel.setAttribute('aria-label', '文档预览');
    let pointerInPanel = false;
    let expandDetail: (() => void) | null = null;
    panel.addEventListener('mouseenter', () => { pointerInPanel = true; if (timer) clearTimeout(timer); expandDetail?.(); });
    panel.addEventListener('mouseleave', () => { pointerInPanel = false; timer = setTimeout(close, 200); });
    const title = document.createElement('strong'); title.textContent = dom.textContent; panel.append(title);
    const bounds = dom.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 360))}px`;
    panel.style.top = `${Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 240))}px`;
    document.body.append(panel); popup = panel;
    const recovery = port.recoveryAction(info);
    if (recovery) {
      const action = document.createElement('button'); action.type = 'button'; action.textContent = recovery.label;
      action.onclick = () => { action.disabled = true; void recovery.activate().then(async () => { const refreshed = await refresh(); if (refreshed?.status === 'available') { close(); await port.open(refreshed); } }).catch(error => { action.disabled = false; port.report(error); }); };
      panel.append(action);
    }
    const preview = await port.preview(documentId);
    if (destroyed || popup !== panel) return;
    if (preview.content?.image) { const image = document.createElement('img'); image.src = preview.content.image.dataUri; image.alt = preview.title ?? '文档封面'; panel.append(image); }
    const summary = document.createElement('p'); summary.textContent = preview.content?.summary ?? (preview.status === 'plugin_unavailable' ? '需要启用或安装对应插件' : '预览不可用'); panel.append(summary);
    const detail = preview.content?.detail;
    const renderDetail = port.readDetailRenderer(info) ?? (detail ? (element: HTMLElement) => port.renderDetail(element, detail.text) : null);
    if (renderDetail) {
      const expand = document.createElement('button'); expand.type = 'button'; expand.textContent = '展开';
      let loading = false;
      expandDetail = () => {
        if (disposeDetail || loading) return;
        loading = true;
        panel.querySelector(':scope > img')?.remove(); summary.remove();
        const content = document.createElement('div'); content.className = 'document-reference-detail'; panel.append(content);
        void renderDetail(content).then(dispose => {
          if (destroyed || popup !== panel) { dispose(); return; }
          disposeDetail = dispose; expand.remove();
          panel.style.top = `${Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - panel.getBoundingClientRect().height - 8))}px`;
        }).catch(error => { loading = false; content.remove(); port.report(error); });
      };
      expand.onclick = expandDetail; panel.append(expand);
      if (pointerInPanel) expandDetail();
    }
  }
  dom.addEventListener('mouseenter', () => { const generation = ++hoverGeneration; if (timer) clearTimeout(timer); timer = setTimeout(() => { void show(generation).catch(port.report); }, 400); });
  dom.addEventListener('mouseleave', () => { hoverGeneration += 1; if (timer) clearTimeout(timer); timer = setTimeout(close, 200); });
  const open = () => { void refresh().then(info => { if (!info) return; if (info.status === 'plugin_unavailable') return show(++hoverGeneration); return port.open(info); }).catch(port.report); };
  dom.addEventListener('click', event => { event.preventDefault(); open(); });
  dom.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); open(); } });
  const unsubscribe = port.subscribe(documentId, () => { hoverGeneration += 1; close(); void refresh().catch(port.report); });
  void refresh().catch(port.report);
  return { dom, stopEvent: () => true, destroy() { destroyed = true; hoverGeneration += 1; unsubscribe(); close(); render(null, icon); } };
}
