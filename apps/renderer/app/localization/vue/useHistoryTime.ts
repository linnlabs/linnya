import {
  formatHistoryDateTime,
  formatHistoryTime,
  formatScheduledDate,
  formatScheduledTime,
  type HistoryTimeInput,
} from '@app/schemas';
import { getCurrentScope, onScopeDispose, readonly, ref, type Ref } from 'vue';
import { createRepeatingTimer } from '@linnya/renderer-ui';
import { useLocalizationStore } from '../store/localizationStore';

/** 相对时间（“12 分钟前”）的刷新间隔；所有组件共用一个时钟，没人用时停掉。 */
const CLOCK_INTERVAL_MS = 30_000;

const sharedNow: Ref<number> = ref(Date.now());
const clock = createRepeatingTimer();
let subscribers = 0;

function subscribeClock(): void {
  subscribers += 1;
  if (clock.running) return;
  sharedNow.value = Date.now();
  clock.start(() => { sharedNow.value = Date.now(); }, CLOCK_INTERVAL_MS);
}

function unsubscribeClock(): void {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers > 0 || !clock.running) return;
  clock.stop();
}

export interface UseHistoryTimeResult {
  /** 共用时钟（毫秒），每 30 秒走一次；不经模板渲染的 DOM 可以 watch 它重画。 */
  readonly now: Readonly<Ref<number>>;
  /** 列表短写法：刚刚 / 12 分钟前 / 14:32 / 昨天 14:32 / 11月9日 / 2025年11月9日；随时钟与语言更新。 */
  readonly historyTime: (value: HistoryTimeInput | null | undefined) => string;
  /** 完整写法：2026年11月9日 14:32；悬停提示、详情用。 */
  readonly historyDateTime: (value: HistoryTimeInput | null | undefined) => string;
  /** 计划时刻：今天 09:00 / 明天 09:00 / 11月27日 周五 10:00；定时任务的下次运行与计划时间用。 */
  readonly scheduledTime: (value: HistoryTimeInput | null | undefined) => string;
  /** 计划日期：11月30日 / 2027年1月3日。 */
  readonly scheduledDate: (value: HistoryTimeInput | null | undefined) => string;
}

/**
 * 界面里显示“某件事发生在什么时候”的唯一入口。规则在 `@app/schemas` 的 history-time，
 * Backend 与命令行用同一份；这里只补当前语言和定时刷新的“现在”。
 */
export function useHistoryTime(): UseHistoryTimeResult {
  const store = useLocalizationStore();
  if (getCurrentScope()) {
    subscribeClock();
    onScopeDispose(unsubscribeClock);
  }
  return {
    now: readonly(sharedNow),
    historyTime: value => formatHistoryTime(value, { locale: store.currentLocale, now: sharedNow.value }),
    historyDateTime: value => formatHistoryDateTime(value, { locale: store.currentLocale }),
    scheduledTime: value => formatScheduledTime(value, { locale: store.currentLocale, now: sharedNow.value }),
    scheduledDate: value => formatScheduledDate(value, { locale: store.currentLocale, now: sharedNow.value }),
  };
}
