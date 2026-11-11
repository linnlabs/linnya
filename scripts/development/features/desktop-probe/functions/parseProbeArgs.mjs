import { parseArgs } from 'node:util';
import { defaultOptions, ProbeError } from '../definitions/probeContract.mjs';

const definitions = {
  up: { string: ['mode', 'window', 'size', 'entry', 'clone-data'], boolean: ['fresh', 'no-build'] },
  restart: { string: ['mode', 'window', 'size'], boolean: ['fresh', 'no-build'] },
  status: { boolean: ['all'] },
  stop: { boolean: ['clean'] },
  reload: {},
  snapshot: { string: ['within', 'max-lines', 'grep', 'role'], boolean: ['all', 'json'] },
  open: { boolean: ['overview'] },
  fonts: {},
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

export function usage(message, hint = '运行 pnpm -s probe help 查看命令。') {
  throw new ProbeError('USAGE', message, hint);
}

/** 其他工具里的常见叫法，直接指到探针的写法。 */
const commandAliases = {
  list: 'status --all', ls: 'status --all', ps: 'status --all',
  screenshot: 'shot', capture: 'shot', screen: 'shot',
  start: 'up', launch: 'up', down: 'stop', kill: 'stop', quit: 'stop',
  find: 'snapshot --grep <文字>', query: 'snapshot --grep <文字>', search: 'snapshot --grep <文字>', tree: 'snapshot',
  goto: 'open <ID>', navigate: 'open <ID>',
  js: 'eval', exec: 'eval', evaluate: 'eval', run: 'eval',
  log: 'logs', tap: 'click', fill: 'type', input: 'type', key: 'press',
};
const optionAliases = {
  out: '截图与录制的文件在结果的 artifacts[].path，不需要指定输出路径。',
  output: '截图与录制的文件在结果的 artifacts[].path，不需要指定输出路径。',
  path: '截图与录制的文件在结果的 artifacts[].path，不需要指定输出路径。',
  text: 'text=<文字> 直接写成目标位置参数。',
};

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function closest(input, candidates) {
  const ranked = candidates
    .map(candidate => ({ candidate, distance: editDistance(input, candidate) }))
    .filter(({ candidate, distance }) => distance <= Math.max(1, Math.floor(candidate.length / 3)))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0]?.candidate;
}

function unknownCommand(command) {
  const alias = commandAliases[command] ?? commandAliases[closest(command, Object.keys(commandAliases))];
  const suggestion = closest(command, Object.keys(definitions)) ?? alias;
  usage(`未知命令 ${command}`, suggestion
    ? `是不是 pnpm -s probe ${suggestion}？运行 pnpm -s probe help 查看全部命令。`
    : '运行 pnpm -s probe help 查看命令。');
}

function unknownOption(command, error) {
  const option = /Unknown option '--?([^']+)'/.exec(error.message)?.[1];
  if (!option) usage(error.message);
  const spec = definitions[command];
  const known = ['name', ...(spec.string ?? []), ...(spec.boolean ?? [])];
  const near = closest(option, known);
  const listed = known.map(key => `--${key}`).join(' ');
  usage(`${command} 没有 --${option} 选项`, [
    near ? `是不是 --${near}？` : optionAliases[option],
    `${command} 可用：${listed}`,
  ].filter(Boolean).join(''));
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
  if (!Object.hasOwn(definitions, command)) unknownCommand(command);
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
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') unknownOption(command, error);
    usage(error.message);
  }
  const { values, positionals } = parsed;
  // 这两处按 CSS 选择器查询，text= 写进去会变成浏览器的选择器语法错误。
  if (command === 'wait' && values.selector?.startsWith('text=')) {
    usage('wait 的 --selector 只接受 CSS 选择器', '按文字等待用 wait --text <文字>。');
  }
  if (command === 'record' && values.target?.startsWith('text=')) {
    usage('record 的 --target 只接受 @引用或 CSS 选择器', '先用 snapshot --grep <文字> 取 @引用。');
  }
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
