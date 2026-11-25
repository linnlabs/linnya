import { parseArgs } from 'node:util';

export type SchedulesCommand = 'list' | 'show' | 'create' | 'update' | 'pause' | 'resume' | 'run-now';

export interface ParsedSchedulesCommand {
  /** list/create 不带任务 ID，此时不读取。 */
  taskId: string;
  expectedRevision: number | undefined;
  fields: Record<string, unknown>;
}

const COMMANDS: readonly string[] = ['list', 'show', 'create', 'update', 'pause', 'resume', 'run-now'];

export function isSchedulesCommand(value: string | undefined): value is SchedulesCommand {
  return value !== undefined && COMMANDS.includes(value);
}

/**
 * 一次性时间不含引号也能原样到达 CLI：Windows 受管 PowerShell 会去掉原生命令参数里的双引号，
 * JSON 写法在那里第一次必失败。日期和时间的取值范围仍由时间表 schema 校验。
 */
function parseOnce(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/u.exec(value.trim());
  if (!match) throw new Error('--once expects local date and time as YYYY-MM-DDTHH:MM, for example 2027-01-01T09:00.');
  return { kind: 'once', date: match[1], time: match[2] };
}

function parseScheduleJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('--schedule must be JSON. If the shell removed its double quotes, use --once or --cron instead.');
  }
}

/** 只解析参数形状；任务字段的合法性交给创建/更新请求 schema。 */
export function parseSchedulesCommand(command: SchedulesCommand, args: string[]): ParsedSchedulesCommand {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' }, cron: { type: 'string' },
    once: { type: 'string' }, agent: { type: 'string' }, model: { type: 'string' }, 'missed-policy': { type: 'string' },
    permission: { type: 'string' }, revision: { type: 'string' },
  } });
  const hasFlags = Object.keys(values).length > 0;
  if (hasFlags && command !== 'create' && command !== 'update') throw new Error(`Unexpected option for ${command}.`);
  if (values.revision !== undefined && command !== 'update') throw new Error('--revision is only available for update.');
  const expectsTask = command !== 'list' && command !== 'create';
  if (positionals.length !== Number(expectsTask)) throw new Error(expectsTask ? 'Provide one task ID.' : 'Unexpected positional argument.');
  const timing = [values.once, values.cron, values.schedule].filter(value => value !== undefined);
  if (timing.length > 1) throw new Error('Use only one of --once, --cron or --schedule.');
  return {
    taskId: positionals[0],
    expectedRevision: typeof values.revision === 'string' ? Number(values.revision) : undefined,
    fields: {
      name: values.name, prompt: values.prompt, agent: values.agent,
      schedule: values.once !== undefined ? parseOnce(values.once)
        : values.schedule !== undefined ? parseScheduleJson(values.schedule)
          : values.cron ? { kind: 'cron', expression: values.cron } : undefined,
      model_config_id: values.model === 'default' ? null : values.model,
      missed_policy: values['missed-policy'], permission_level: values.permission,
    },
  };
}
