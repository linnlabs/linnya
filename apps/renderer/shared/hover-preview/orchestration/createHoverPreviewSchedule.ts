import { createTimer } from '@linnya/renderer-ui';
import {
  HOVER_PREVIEW_CLOSE_DELAY_MS,
  HOVER_PREVIEW_PREPARE_DELAY_MS,
  HOVER_PREVIEW_READY_GRACE_MS,
  HOVER_PREVIEW_REVEAL_DELAY_MS,
  type HoverPreviewSchedule,
  type HoverPreviewScheduleHandlers,
} from '../definitions/hoverPreviewTiming';

/**
 * 一个悬停预览浮层的时序：先在不可见状态下准备，到停留时间且内容排好才露出。
 * 只管先后顺序，不碰 DOM、定位和数据；调用方在自己的收尾里 close。
 */
export function createHoverPreviewSchedule(handlers: HoverPreviewScheduleHandlers): HoverPreviewSchedule {
  let phase: 'idle' | 'waiting' | 'preparing' | 'revealed' = 'idle';
  // due：已到露出时间；ready：内容已排好。两者都成立，或宽限期用完，才露出。
  let due = false,
    ready = false;
  const prepareTimer = createTimer(),
    revealTimer = createTimer(),
    closeTimer = createTimer();
  function reveal() {
    if (phase !== 'preparing') return;
    revealTimer.cancel();
    phase = 'revealed';
    handlers.reveal();
  }
  function prepare() {
    phase = 'preparing';
    handlers.prepare();
  }
  function reachDue() {
    due = true;
    if (ready) reveal();
    else revealTimer.start(reveal, HOVER_PREVIEW_READY_GRACE_MS);
  }
  function close() {
    prepareTimer.cancel();
    revealTimer.cancel();
    closeTimer.cancel();
    const prepared = phase === 'preparing' || phase === 'revealed';
    phase = 'idle';
    due = false;
    ready = false;
    if (prepared) handlers.close();
  }
  return {
    enter(immediate = false) {
      closeTimer.cancel();
      // 已在准备或已露出：回到触发处只取消关闭，不重新走一遍。
      if (phase !== 'idle') return;
      if (immediate) {
        prepare();
        reachDue();
        return;
      }
      phase = 'waiting';
      prepareTimer.start(prepare, HOVER_PREVIEW_PREPARE_DELAY_MS);
      revealTimer.start(reachDue, HOVER_PREVIEW_REVEAL_DELAY_MS);
    },
    leave() {
      // 还没露出时浮层不可见，指针不可能正移向它：立即取消，在途读取不白跑。
      if (phase !== 'revealed') close();
      else closeTimer.start(close, HOVER_PREVIEW_CLOSE_DELAY_MS);
    },
    stay: () => closeTimer.cancel(),
    ready() {
      if (phase !== 'preparing') return;
      ready = true;
      if (due) reveal();
    },
    close,
  };
}
