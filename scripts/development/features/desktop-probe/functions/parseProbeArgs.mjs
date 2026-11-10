import { parseArgs } from 'node:util';
import { defaultOptions, ProbeError } from '../definitions/probeContract.mjs';

const definitions = {
  up: { string: ['mode', 'window', 'size', 'entry'], boolean: ['fresh'] },
  restart: { string: ['mode', 'window', 'size'], boolean: ['fresh'] },
  status: { boolean: ['all'] },
  stop: { boolean: ['clean'] },
  reload: {},
  snapshot: { string: ['within', 'max-lines'], boolean: ['all', 'json'] },
  shot: { string: ['selector', 'clip', 'pad'], boolean: ['device', 'jpeg'] },
  click: { string: ['selector', 'at', 'button'] },
  dblclick: { string: ['selector', 'at', 'button'] },
  hover: { string: ['selector', 'at'] },
  type: {},
  press: {},
  drag: { string: ['selector', 'at', 'by', 'to', 'steps', 'sample', 'expect-follow', 'tolerance'] },
  scroll: { string: ['selector', 'at', 'dx', 'dy'] },
  wait: { string: ['selector', 'state', 'text', 'expr', 'timeout'], boolean: ['settle'] },
  eval: {},
  logs: { string: ['source', 'level', 'since', 'grep', 'limit'] },
  record: { string: ['target', 'props', 'duration', 'at'] },
  fixture: {},
};

export function usage(message) {
  throw new ProbeError('USAGE', message, '运行 pnpm -s probe help 查看命令。');
}

export function numberOption(value, label, { min = 0, max = Infinity, integer = false } = {}) {
  const result = value === undefined || value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    usage(`${label} 数值无效`);
  }
  return result;
}

export function oneOf(value, choices, label) {
  if (!choices.includes(value)) usage(`${label} 必须是 ${choices.join(' / ')}`);
  return value;
}

export function parseProbeArgs([command = 'help', ...args]) {
  if (command === 'help' || command === '--help') return { command: 'help', commands: Object.keys(definitions) };
  if (!Object.hasOwn(definitions, command)) usage(`未知命令 ${command}`);
  const actionStart = command === 'record' ? args.indexOf('--') : -1;
  const spec = definitions[command];
  const options = {
    name: { type: 'string', default: defaultOptions.name },
    ...Object.fromEntries((spec.string ?? []).map(key => [key, { type: 'string' }])),
    ...Object.fromEntries((spec.boolean ?? []).map(key => [key, { type: 'boolean' }])),
  };
  let parsed;
  try {
    parsed = parseArgs({ args: actionStart < 0 ? args : args.slice(0, actionStart), options, allowPositionals: true });
  } catch (error) {
    usage(error.message);
  }
  const { values, positionals } = parsed;
  return { command, values, positionals, action: actionStart < 0 ? [] : args.slice(actionStart + 1) };
}

export function launchOptions(values) {
  const options = { name: values.name };
  if (values.mode !== undefined) options.mode = oneOf(values.mode, ['dev', 'bundled'], '--mode');
  if (values.window !== undefined) options.window = oneOf(values.window, ['hidden', 'inactive', 'visible'], '--window');
  if (values.entry !== undefined) options.entry = oneOf(values.entry, ['toy'], '--entry');
  if (values.size !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(values.size);
    if (!match) usage('--size 格式为 1400x900');
    options.width = numberOption(match[1], '宽度', { min: 400, max: 4096 });
    options.height = numberOption(match[2], '高度', { min: 300, max: 4096 });
  }
  return options;
}
