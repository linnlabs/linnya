import type { MessageParams } from '@app/localization';
import type { ScheduledTaskMessageKey } from './scheduledTaskMessageCatalog';

export type { ScheduledTaskMessageKey };

export type ScheduledTaskMessageResolver = (key: ScheduledTaskMessageKey, params?: MessageParams) => string;
