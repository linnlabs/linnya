import { ref, watch, type Ref } from 'vue';
import {
  consumeDocumentHistoryPanelRequest,
  useDocumentHistoryPanelRequest,
} from '@/app/layout/orchestration/documentHistoryPanelRequest';

interface DocumentHistoryPanelOptions {
  readonly activeDocumentId: Readonly<Ref<string | null>>;
  /** 当前文档类型的历史预览；没有时不打开面板，外部请求保持等待。 */
  readonly historyPreviewComponent: Readonly<Ref<unknown>>;
  /** 读取实际打开的文档表面的编辑会话标识，交给版本恢复进入该视图的撤销栈。 */
  readonly readClientSessionId: (documentId: string) => string | undefined;
  readonly onOpen?: () => void;
}

/**
 * 顶栏文档历史面板的开关与恢复会话。菜单与其他界面的请求走同一个打开入口，
 * 打开时冻结会话标识；切换文档关闭面板并清空标识，不能把恢复计入后来的视图。
 */
export function useDocumentHistoryPanel(options: DocumentHistoryPanelOptions) {
  const showDocumentHistory = ref(false);
  const historyClientSessionId = ref<string>();

  function openDocumentHistory(): void {
    const documentId = options.activeDocumentId.value;
    if (!documentId || !options.historyPreviewComponent.value) return;
    historyClientSessionId.value = options.readClientSessionId(documentId);
    showDocumentHistory.value = true;
    options.onOpen?.();
  }

  function closeDocumentHistory(): void {
    showDocumentHistory.value = false;
  }

  watch([options.activeDocumentId, options.historyPreviewComponent], () => {
    showDocumentHistory.value = false;
    historyClientSessionId.value = undefined;
  });

  // 对话里点“历史”会先打开文档再请求历史面板；post flush 保证在上面的切换复位之后执行。
  const request = useDocumentHistoryPanelRequest();
  watch([request, options.activeDocumentId, options.historyPreviewComponent], () => {
    if (!options.historyPreviewComponent.value) return;
    if (consumeDocumentHistoryPanelRequest(options.activeDocumentId.value)) openDocumentHistory();
  }, { flush: 'post' });

  return { showDocumentHistory, historyClientSessionId, openDocumentHistory, closeDocumentHistory };
}
