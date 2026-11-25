import type Database from 'better-sqlite3';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import { ScheduledTaskCreateRequestSchema, ScheduledTaskUpdateRequestSchema, type ScheduledTask } from '@app/schemas/scheduled-tasks';
import { readStoredRunActor } from 'src/domains/action-ledger';
import { SqliteRunDescriptorStore } from 'src/app-hosts/linnya/adapters/persistence/run-descriptors';
import { ScheduledTaskPermissionError, type ScheduledTasks } from '../../scheduled-tasks';
import { isSchedulesCommand, parseSchedulesCommand } from '../functions/parseSchedulesCommand';

export const SCHEDULES_USAGE = `linnya schedules list | show <id>
linnya schedules create --name <name> --prompt <instructions> (--once <YYYY-MM-DDTHH:MM> | --cron <five-field-expression> | --schedule <json>) [--agent default|research] [--model <model-id>|default] [--missed-policy run_latest|skip] [--permission read_only|standard|full_access]
linnya schedules update <id> [--revision <number>] [--name ...] [--prompt ...] [--once ... | --cron ... | --schedule ...] [--agent ...] [--model ...] [--missed-policy ...] [--permission ...]
linnya schedules pause <id> | resume <id> | run-now <id>
One time: --once 2027-01-01T09:00. Recurring: --cron "0 9 * * *" (every day at 09:00) or --cron "30 8 * * 1-5" (weekdays at 08:30). Both work unchanged in PowerShell and POSIX shells.
--schedule takes JSON such as {"kind":"daily","time":"09:00"}; shells may strip its inner double quotes (Windows PowerShell does), so prefer --once or --cron.
Schedules use local time with at least one hour between runs. The project comes from this conversation. Default model: Settings. Default permission: this conversation. Use the Scheduled Tasks view to delete a task or set a higher permission level.`;

const ACCESS = { conversationFiles: 'none', externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied' } as const;
const SELF_WRITE = 'scheduled_run_write_forbidden: A scheduled run and its child runs cannot create, change, pause, resume, or start scheduled tasks.';
const FULL_ACCESS = 'Tell the user in your final response that this task runs unattended with Full Access and may perform high-risk operations without prompting.';
const fail = (stderr: string, exitCode = 2) => ({ exitCode, stdout: '', stderr: `${stderr}\n` });
const result = (value: unknown) => ({ exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: '' });

function summarize(task: ScheduledTask) {
  const { id, name, state, schedule, agent, permission_level, model_config_id, next_run_at, revision } = task;
  return { id, name, state, schedule, agent, permission_level, model_config_id, next_run_at, revision };
}

export function prepareSchedulesCli(db: Database.Database, argv: string[], readTasks?: () => ScheduledTasks | undefined): ReturnType<BackendPluginCliContribution['prepare']> {
  const [command, ...args] = argv;
  if (command === '--help' || (args.length === 1 && args[0] === '--help')) {
    return { status: 'completed', result: { exitCode: 0, stdout: `${SCHEDULES_USAGE}\n`, stderr: '' } };
  }
  if (!isSchedulesCommand(command)) return { status: 'completed', result: fail(SCHEDULES_USAGE) };

  const write = command !== 'list' && command !== 'show';
  let parsed: ReturnType<typeof parseSchedulesCommand>;
  try {
    parsed = parseSchedulesCommand(command, args);
  } catch (error) {
    return { status: 'completed', result: fail(`${error instanceof Error ? error.message : 'Invalid arguments'}\n${SCHEDULES_USAGE}`) };
  }
  const { taskId, expectedRevision, fields } = parsed;
  return { status: 'ready', plan: {
    access: { ...ACCESS, internalDataAccess: write ? 'write' : 'required' },
    async execute({ conversationId, agentRunId, projectId, signal }) {
      signal.throwIfAborted();
      const tasks = readTasks?.();
      if (!tasks) return fail('Scheduled tasks are unavailable.', 69);
      if (!projectId) return fail('This conversation has no project.');
      if (command === 'list') return result((await tasks.list(projectId)).tasks.map(summarize));
      if (command === 'show') {
        const task = await tasks.show(taskId, projectId);
        return task.ok ? result(task.task) : fail(task.message, 1);
      }
      if (!agentRunId || !conversationId) return fail('Scheduled task changes require an admitted conversation run.', 77);
      const origin = readStoredRunActor(db, agentRunId, conversationId);
      const descriptor = origin ? await new SqliteRunDescriptorStore(db).load(origin.rootRunId) : null;
      if (!descriptor || descriptor.conversationId !== conversationId) return fail('The originating run could not be verified.', 77);
      if (descriptor.options?.scheduled_run) return fail(SELF_WRITE, 77);
      if (descriptor.commandPermission.status !== 'available') return fail('Conversation permissions are unavailable.', 77);
      const permission = descriptor.commandPermission.snapshot.permission_level;
      const actor = { conversationId, rootRunId: descriptor.runId, permission };
      const existing = command === 'create' ? null : await tasks.show(taskId, projectId);
      if (existing && !existing.ok) return fail(existing.message, 1);
      const requested = fields.permission_level ?? existing?.task.permission_level ?? permission;
      try {
        let changed;
        if (command === 'create') {
          const input = ScheduledTaskCreateRequestSchema.safeParse({ ...fields, project_id: projectId,
            agent: fields.agent ?? 'default', model_config_id: fields.model_config_id ?? null,
            missed_policy: fields.missed_policy ?? 'run_latest', permission_level: requested });
          if (!input.success) return fail(input.error.message);
          changed = await tasks.create(input.data, actor);
        } else if (command === 'update' && existing?.ok) {
          const input = ScheduledTaskUpdateRequestSchema.safeParse({ ...fields, task_id: taskId, expected_revision: expectedRevision ?? existing.task.revision });
          if (!input.success) return fail(input.error.message);
          changed = await tasks.update(input.data, actor, projectId);
        } else if (existing?.ok) {
          changed = command === 'run-now' ? await tasks.runNow(taskId, projectId, actor)
            : await tasks.setEnabled(taskId, command === 'resume', actor, projectId);
        } else {
          return fail('Scheduled task not found.', 1);
        }
        if (!changed.ok) return fail(`${changed.code}: ${changed.message}`, 1);
        return result({ ...summarize(changed.task), ...(changed.task.permission_level === 'full_access' ? { warning: FULL_ACCESS } : {}) });
      } catch (error) {
        if (error instanceof ScheduledTaskPermissionError) return fail(error.message, 77);
        throw error;
      }
    },
  } };
}
