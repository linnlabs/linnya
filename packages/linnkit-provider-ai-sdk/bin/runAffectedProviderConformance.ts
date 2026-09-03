import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { selectAffectedProviderConformance } from '../conformance/definitions/providerConformanceSelection';
import { createAiSdkLanguageModelRegistry } from '../src/registry/createAiSdkLanguageModelRegistry';

interface ParsedArguments {
  readonly capability_ids: readonly string[];
  readonly package_names: readonly string[];
  readonly all: boolean;
  readonly list: boolean;
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少值。`);
  return value;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const capabilityIds: string[] = [];
  const packageNames: string[] = [];
  let all = false;
  let list = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (argument === '--') {
      continue;
    } else if (argument === '--all') {
      all = true;
    } else if (argument === '--list') {
      list = true;
    } else if (argument === '--capability') {
      capabilityIds.push(readOptionValue(args, index, '--capability'));
      index += 1;
    } else if (argument.startsWith('--capability=')) {
      capabilityIds.push(argument.slice('--capability='.length));
    } else if (argument === '--package') {
      packageNames.push(readOptionValue(args, index, '--package'));
      index += 1;
    } else if (argument.startsWith('--package=')) {
      packageNames.push(argument.slice('--package='.length));
    } else {
      throw new Error(`不支持的参数: ${argument}`);
    }
  }

  return { capability_ids: capabilityIds, package_names: packageNames, all, list };
}

function printUsage(): void {
  console.log(
    '用法: pnpm conformance:affected -- --capability <id> | --package <name> | --all [--list]'
  );
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const args = parseArguments(process.argv.slice(2));
  const factories = createAiSdkLanguageModelRegistry().entries;
  if (args.list && !args.all && args.capability_ids.length === 0 && args.package_names.length === 0) {
    console.log(
      JSON.stringify(
        factories.map(factory => ({
          capability_id: factory.capability_id,
          package_name: factory.package_name,
          package_version: factory.package_version,
        })),
        null,
        2
      )
    );
    process.exit(0);
  }

  const selection = selectAffectedProviderConformance({
    factories,
    capability_ids: args.capability_ids,
    package_names: args.package_names,
    all: args.all,
  });
  console.log(JSON.stringify(selection, null, 2));
  if (!args.list) {
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmExecutable, ['exec', 'vitest', 'run', ...selection.test_files], {
      cwd: packageRoot,
      stdio: 'inherit',
    });
    console.log('定向 conformance 通过；合并上游升级前仍必须运行 pnpm conformance 全矩阵。');
  }
} catch (error: unknown) {
  printUsage();
  console.error(error instanceof Error ? error.message : '无法选择 Provider conformance。');
  process.exit(1);
}
