import { ref, watch, type Ref } from 'vue';
import { useTimer } from '@linnya/renderer-ui';
import {
  consumeDocumentHistoryPanelRequest,
  hasDocumentHistoryPanelRequest,
  useDocumentHistoryPanelRequest,
} from '@/app/layout/orchestration/documentHistoryPanelRequest';

/** 外部请求打开历史时，文档表面可能还在挂载；按这个间隔等它登记编辑会话，请求过期即停止。 */
const SESSION_RETRY_MS = 50;

interface DocumentHistoryPanelOptions {
  readonly activeDocumentId: Readonly<Ref<string | null>>;
  /** 当前文档类型的历史预览；没有时不打开面板，外部请求保持等待。 */
  readonly historyPreviewComponent: Readonly<Ref<unknown>>;
  /**
   * 读取实际打开的文档表面的编辑会话标识，交给版本恢复进入该视图的撤销栈。
   * `undefined` 表示该类型不使用会话；`null` 表示类型需要会话但表面尚未登记。
   */
  readonly readClientSessionId: (documentId: string) => string | null | undefined;
  readonly onOpen?: () => void;
}

/**
 * 顶栏文档历史面板的开关与恢复会话。菜单与其他界面的请求走同一个打开入口，
 * 打开时冻结会话标识；切换文档关闭面板并清空标识，不能把恢复计入后来的视图。
 */
export function useDocumentHistoryPanel(options: DocumentHistoryPanelOptions) {
  const showDocumentHistory = ref(false);
  const historyClientSessionId = ref<string>();
  const retry = useTimer();

  function show(sessionId: string | undefined): void {
    historyClientSessionId.value = sessionId;
    showDocumentHistory.value = true;
    options.onOpen?.();
  }

  function openDocumentHistory(): void {
    const documentId = options.activeDocumentId.value;
    if (!documentId || !options.historyPreviewComponent.value) return;
    show(options.readClientSessionId(documentId) ?? undefined);
  }

  function closeDocumentHistory(): void {
    showDocumentHistory.value = false;
  }

  // 对话里点“历史”会先打开文档再请求历史面板：等表面登记会话后再消费请求，
  // 否则恢复缺少视图身份而被后台拒绝。
  function openRequested(): void {
    retry.cancel();
    const documentId = options.activeDocumentId.value;
    if (!documentId || !options.historyPreviewComponent.value) return;
    if (!hasDocumentHistoryPanelRequest(documentId)) return;
    const sessionId = options.readClientSessionId(documentId);
    if (sessionId === null) {
      retry.start(openRequested, SESSION_RETRY_MS);
      return;
    }
    if (consumeDocumentHistoryPanelRequest(documentId)) show(sessionId);
  }

  watch([options.activeDocumentId, options.historyPreviewComponent], () => {
    retry.cancel();
    showDocumentHistory.value = false;
    historyClientSessionId.value = undefined;
  });

  // post flush 保证在上面的切换复位之后执行。
  const request = useDocumentHistoryPanelRequest();
  watch([request, options.activeDocumentId, options.historyPreviewComponent], openRequested, {
    flush: 'post',
  });

  return { showDocumentHistory, historyClientSessionId, openDocumentHistory, closeDocumentHistory };
}
