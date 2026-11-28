import { EventEmitter } from 'node:events';
import type { Notification } from 'electron';
import { expect, it } from 'vitest';
import { holdNotice } from './holdNotice';

function show(held: Set<Notification>): Notification {
  const notice = new EventEmitter() as unknown as Notification;
  holdNotice(held, notice);
  return notice;
}

it('收进通知中心的通知继续留着，点开、关掉或失败后才放开', () => {
  const held = new Set<Notification>();
  const [clicked, dismissed, closed, failed] = [show(held), show(held), show(held), show(held)];

  clicked.emit('close', { reason: 'timedOut' });
  expect(held.size).toBe(4);

  clicked.emit('click');
  dismissed.emit('close', { reason: 'userCanceled' });
  closed.emit('close');
  failed.emit('failed', {}, 'error');
  expect(held.size).toBe(0);
});
