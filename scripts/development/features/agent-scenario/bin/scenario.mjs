import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenarioArgs, ScenarioUsageError } from '../functions/parseScenarioArgs.mjs';
import { runScenarioCommand } from '../orchestration/runScenarioCommand.mjs';

const USAGE = `pnpm -s scenario <命令>
  list                         列出用场景夹具写的测试与用例
  run [文件片段...] [--grep 用例名] [--verbose]
                               运行场景测试（默认隐藏 Runtime 日志）
  fuzz [--runs N] [--seed S]   运行随机组合测试（*.fuzz.*），可加量或固定种子
  replay <seed> [path]         按失败时打印的 seed / path 复现
  new <名字>                   生成一个最小可运行的 Flow 场景测试骨架`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
try {
  const parsed = parseScenarioArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    console.log(USAGE);
  } else {
    process.exitCode = await runScenarioCommand(parsed, repoRoot);
  }
} catch (error) {
  if (error instanceof ScenarioUsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
