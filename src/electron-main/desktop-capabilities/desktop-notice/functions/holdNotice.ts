import type { Notification } from 'electron';

/**
 * 在通知还能被点击期间留住它：系统不替应用留着通知对象，被回收后点系统里的通知就没有反应。
 * 横幅到时收起不等于关掉，它还在 Windows 的通知中心里，仍然能点。
 */
export function holdNotice(held: Set<Notification>, notice: Notification): void {
  const release = (): void => {
    held.delete(notice);
  };
  held.add(notice);
  notice.once('click', release);
  notice.once('failed', release);
  notice.on('close', details => {
    if (details?.reason !== 'timedOut') release();
  });
}
