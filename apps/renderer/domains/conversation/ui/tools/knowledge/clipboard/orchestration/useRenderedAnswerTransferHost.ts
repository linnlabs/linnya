import { nextTick, ref, shallowRef, type Ref } from 'vue';
import type { BaseMessage } from '../../../../../types';
import type {
  RenderedAnswerTransferPort,
  RenderedAnswerTransferRequest,
  RenderedAnswerTransferSession,
} from '../definitions/renderedAnswerTransfer';

export interface RenderedAnswerHostExposed {
  readonly rootElement: HTMLElement | null;
}

const MAX_SETTLE_FRAMES = 30;

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function readRenderedSignature(containerEl: HTMLElement, expectedCount: number): string | null {
  const roots = containerEl.querySelectorAll<HTMLElement>(
    '.message-type-final_answer .markstream-message-renderer',
  );
  if (roots.length !== expectedCount) return null;
  return Array.from(roots, root => root.innerHTML).join('\n<!-- answer-boundary -->\n');
}

async function waitForRenderedAnswers(containerEl: HTMLElement, expectedCount: number): Promise<void> {
  let previousSignature: string | null = null;
  for (let frame = 0; frame < MAX_SETTLE_FRAMES; frame += 1) {
    await waitForAnimationFrame();
    const signature = readRenderedSignature(containerEl, expectedCount);
    if (signature !== null && signature === previousSignature) return;
    previousSignature = signature;
  }
  throw new Error('[answer-transfer] 真实回答组件未在预期帧数内完成渲染');
}

function buildPlainText(answers: readonly BaseMessage[]): string {
  return answers.map(answer => answer.content).join('\n\n');
}

export function useRenderedAnswerTransferHost(): {
  readonly activeAnswers: Ref<readonly BaseMessage[]>;
  readonly hostRef: Ref<RenderedAnswerHostExposed | null>;
  readonly port: RenderedAnswerTransferPort;
} {
  const activeAnswers = shallowRef<readonly BaseMessage[]>([]);
  const hostRef = ref<RenderedAnswerHostExposed | null>(null);
  let queue: Promise<void> = Promise.resolve();

  const execute = async <TResult>(
    request: RenderedAnswerTransferRequest,
    consume: (session: RenderedAnswerTransferSession) => Promise<TResult> | TResult,
  ): Promise<TResult> => {
    activeAnswers.value = request.answers;
    try {
      await nextTick();
      const containerEl = hostRef.value?.rootElement ?? null;
      if (!containerEl) {
        throw new Error('[answer-transfer] 回答渲染宿主未挂载');
      }
      await waitForRenderedAnswers(containerEl, request.answers.length);
      return await consume({
        answerMessageIds: request.answers.map(answer => answer.id),
        containerEl,
        plainText: buildPlainText(request.answers),
      });
    } finally {
      activeAnswers.value = [];
      await nextTick();
    }
  };

  const port: RenderedAnswerTransferPort = {
    withRenderedAnswers<TResult>(
      request: RenderedAnswerTransferRequest,
      consume: (session: RenderedAnswerTransferSession) => Promise<TResult> | TResult,
    ): Promise<TResult> {
      const operation = new Promise<TResult>((resolve, reject) => {
        queue = queue.then(async () => {
          try {
            resolve(await execute(request, consume));
          } catch (error: unknown) {
            reject(error);
          }
        });
      });
      return operation;
    },
  };

  return { activeAnswers, hostRef, port };
}
