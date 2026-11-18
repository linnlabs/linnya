/** `pnpm -s scenario <command> ...` 的参数解析；只做解析，不碰文件和进程。 */
export const SCENARIO_COMMANDS = ['list', 'run', 'fuzz', 'replay', 'new'];

export class ScenarioUsageError extends Error {}

export function parseScenarioArgs(argv) {
  const [command = 'list', ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') return { command: 'help' };
  if (!SCENARIO_COMMANDS.includes(command)) {
    throw new ScenarioUsageError(`未知命令：${command}（可用：${SCENARIO_COMMANDS.join(' / ')}）`);
  }
  const positional = [];
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'verbose') {
      options.verbose = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new ScenarioUsageError(`--${key} 需要一个值`);
    index += 1;
    if (key === 'runs' || key === 'seed') {
      const number = Number(value);
      if (!Number.isInteger(number)) throw new ScenarioUsageError(`--${key} 必须是整数`);
      options[key] = number;
    } else if (key === 'grep') {
      options[key] = value;
    } else {
      throw new ScenarioUsageError(`未知参数：--${key}`);
    }
  }
  if (command === 'replay') {
    const [seed, path] = positional;
    if (seed === undefined || !Number.isInteger(Number(seed))) throw new ScenarioUsageError('replay 需要 seed：scenario replay <seed> [path]');
    return { command, seed: Number(seed), path, options };
  }
  if (command === 'new') {
    const [name] = positional;
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new ScenarioUsageError('new 需要小写短横线名字：scenario new steer-after-error');
    return { command, name, options };
  }
  return { command, filters: positional, options };
}

/** 运行用的环境变量：随机组合测试按这些变量决定次数、种子与路径；非 --verbose 时让场景夹具关掉 Runtime 控制台日志。 */
export function scenarioEnv(parsed) {
  const env = {};
  if (!parsed.options?.verbose) env.SCENARIO_QUIET = '1';
  if (parsed.options?.runs !== undefined) env.SCENARIO_RUNS = String(parsed.options.runs);
  if (parsed.options?.seed !== undefined) env.SCENARIO_SEED = String(parsed.options.seed);
  if (parsed.command === 'replay') {
    env.SCENARIO_SEED = String(parsed.seed);
    env.SCENARIO_RUNS = '1';
    if (parsed.path) env.SCENARIO_PATH = parsed.path;
  }
  return env;
}
