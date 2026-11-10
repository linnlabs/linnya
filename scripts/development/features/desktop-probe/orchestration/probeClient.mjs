import { ProbeError } from '../definitions/probeContract.mjs';
import { launchOptions, numberOption, oneOf, parseProbeArgs, usage } from '../functions/parseProbeArgs.mjs';
import { connectCdp, evaluate, findPage, waitFor } from '../infrastructure/cdpClient.mjs';
import { performAction } from './probeActions.mjs';
import { changeProbeInstance, listProbes, probeStatus, requireReady } from './probeInstances.mjs';
import { probeLogs, shotPage, snapshotPage, waitForPage } from './probeObservation.mjs';
import { pageFacts } from './probePage.mjs';

const actionCommands = new Set(['click', 'dblclick', 'hover', 'type', 'press', 'drag', 'scroll']);

function numericList(raw, length, label) {
  const values = raw.split(',');
  if (values.length !== length) usage(`${label} 需要 ${length} 个逗号分隔的数字`);
  return values.map(value => numberOption(value, label, { min: -Infinity }));
}

export function probeTarget(raw) {
  if (raw.startsWith('@')) return { ref: raw };
  if (raw.startsWith('text=')) {
    if (raw.length === 5) usage('text= 后需要文字');
    return { text: raw.slice(5) };
  }
  return { selector: raw };
}

function actionTarget(raw, values) {
  const targets = [raw, values.selector, values.at].filter(value => value !== undefined);
  if (targets.length !== 1) usage('需要一个目标 @引用、--selector 或 --at');
  return values.at !== undefined ? { point: numericList(values.at, 2, '--at') } : probeTarget(targets[0]);
}

function parseAction({ command, values, positionals }) {
  const [first, second] = positionals;
  if (command === 'type' || command === 'press') {
    if (first === undefined || positionals.length > (command === 'type' ? 2 : 1)) usage(`${command} 参数无效`);
    return command === 'type' ? { command, text: first, target: second && probeTarget(second) } : { command, key: first };
  }
  if (positionals.length > 1) usage('只接受一个目标');
  const target = actionTarget(first, values);
  const options = { command, target };
  if (command === 'drag') {
    if (Boolean(values.by) === Boolean(values.to)) usage('drag 需要 --by 或 --to');
    const follow = values['expect-follow'];
    if (follow !== undefined && !values.sample) usage('--expect-follow 需要 --sample');
    return {
      ...options,
      by: values.by && numericList(values.by, 2, '--by'),
      to: values.to && probeTarget(values.to),
      steps: numberOption(values.steps ?? '10', '--steps', { min: 1, max: 100, integer: true }),
      sample: values.sample,
      follow: follow && oneOf(follow, ['x', 'y'], '--expect-follow'),
      tolerance: numberOption(values.tolerance ?? '2', '--tolerance'),
    };
  }
  if (command === 'scroll') {
    if (values.dy === undefined && values.dx === undefined) usage('scroll 需要 --dy 或 --dx');
    return { ...options, dx: numberOption(values.dx ?? '0', '--dx', { min: -Infinity }), dy: numberOption(values.dy ?? '0', '--dy', { min: -Infinity }) };
  }
  if (values.button) options.button = oneOf(values.button, ['left', 'right', 'middle'], '--button');
  return options;
}

export function createProbeClient({ name = 'default' } = {}) {
  return {
    async run(command, ...args) {
      const parsed = parseProbeArgs([command, '--name', name, ...args]);
      return runProbeCommand(parsed);
    },
  };
}

export async function connectProbePage(name) {
  const session = requireReady(name);
  const target = await findPage(session.cdpPort, session.viteUrl);
  if (!target) throw new ProbeError('NOT_RUNNING', '找不到该实例的 Renderer');
  return { session, cdp: await connectCdp(target.webSocketDebuggerUrl) };
}

export async function runProbeCommand(parsed) {
  const { command, values, positionals } = parsed;
  if (command === 'help') {
    return { commands: parsed.commands, documentation: 'scripts/development/features/desktop-probe/README.md' };
  }
  if (['up', 'stop', 'restart', 'status'].includes(command)) {
    if (positionals.length) usage(`${command} 不接受位置参数`);
    if (command === 'status') return values.all ? { instances: listProbes() } : probeStatus(values.name);
    if (process.platform !== 'darwin') throw new ProbeError('UNSUPPORTED_PLATFORM', 'Desktop 探针当前支持 macOS');
    return changeProbeInstance(command, launchOptions(values), values);
  }
  if (command === 'logs') return probeLogs(probeStatus(values.name), values);
  if (command === 'fixture') {
    const { installFixture } = await import('./probeFixtures.mjs');
    return installFixture(requireReady(values.name), positionals);
  }
  const action = actionCommands.has(command) ? parseAction(parsed) : null;
  const { session, cdp } = await connectProbePage(values.name);
  try {
    if (action) {
      const before = await pageFacts(cdp);
      const cursor = probeLogs(session).cursor;
      const result = await performAction(cdp, action);
      const after = await pageFacts(cdp);
      const errors = probeLogs(session, { since: String(cursor), level: 'error', limit: '3' });
      return { ...result, after: { path: after.path, focus: after.focus,
        newLayers: after.layers.filter(layer => !before.layers.some(old => old.role === layer.role && old.label === layer.label)),
        errorCount: errors.total, errors: errors.entries } };
    }
    if (command === 'eval') {
      if (positionals.length !== 1) usage('eval 需要一个 JavaScript 表达式');
      return { value: await evaluate(cdp, positionals[0]) };
    }
    if (command === 'wait') return await waitForPage(cdp, values);
    if (command === 'reload') {
      const before = await evaluate(cdp, 'performance.timeOrigin');
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(() => evaluate(cdp, `performance.timeOrigin !== ${before} && document.readyState === 'complete'`),
        '新页面加载', 15_000);
      return { reloaded: true };
    }
    if (command === 'open') {
      if (positionals.length !== 1) usage('open 需要一个对话、文档或项目 ID（或 assistant）');
      const { openWorkspaceObject } = await import('./probeOpen.mjs');
      return await openWorkspaceObject(cdp, session, positionals[0], { overview: values.overview });
    }
    if (command === 'fonts') {
      if (!positionals.length) usage('fonts 需要至少一个目标：@引用、选择器或 text=<文字>');
      const { inspectFonts } = await import('./probeFonts.mjs');
      return await inspectFonts(cdp, positionals.map(probeTarget));
    }
    if (command === 'snapshot') {
      if (positionals.length) usage('snapshot 用 --within 指定范围、--grep 过滤文字');
      return await snapshotPage(cdp, session, {
        target: values.within && probeTarget(values.within), all: values.all, json: values.json,
        grep: values.grep, roles: values.role && new Set(values.role.split(',')),
        limit: numberOption(values['max-lines'] ?? '50', '--max-lines', { min: 1, max: 1000, integer: true }),
      });
    }
    if (command === 'shot') {
      if (positionals.length > 1 || [positionals[0], values.selector, values.clip].filter(Boolean).length > 1) {
        usage('shot 只能指定一种裁剪目标');
      }
      const raw = positionals[0] ?? values.selector;
      return await shotPage(cdp, session, {
        target: raw && probeTarget(raw), clip: values.clip && numericList(values.clip, 4, '--clip'),
        pad: numberOption(values.pad ?? '0', '--pad'), device: values.device, jpeg: values.jpeg,
      });
    }
    if (command === 'record') {
      const { recordAnimation } = await import('./probeRecording.mjs');
      if (positionals.length !== 1 || !values.target || !parsed.action.length) usage('record 需要 curve / frames、--target 和 -- 后的动作');
      const recorded = parseProbeArgs(parsed.action);
      if (!actionCommands.has(recorded.command)) usage('record 只接受页面动作');
      return await recordAnimation(cdp, session, positionals[0], values, parseAction(recorded));
    }
    usage(`未知页面命令 ${command}`);
  } finally {
    cdp.close();
  }
}
