import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SCHEDULED_TASK_CONCURRENCY_DEFAULT, ScheduledTaskSettingsSchema, type ScheduledTaskSettings } from '@app/schemas/scheduled-tasks';
import { isRecord } from '@linnya/foundation';

/** 设置属于当前 App Server profile，写入成功后才更新运行中的值。 */
export function createScheduledTaskSettings(file: string) {
  let current: ScheduledTaskSettings = { max_concurrent_runs: SCHEDULED_TASK_CONCURRENCY_DEFAULT };
  try {
    current = ScheduledTaskSettingsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }
  return {
    read: () => ({ ...current }),
    write(settings: ScheduledTaskSettings): void {
      const next = { ...current, ...settings };
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
      current = next;
    },
  };
}
