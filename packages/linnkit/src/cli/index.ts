#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { parseCliArgs, readStringOption } from './args';
import { runDoctorCommand } from './doctor';
import { runInitCommand } from './init';
import { runRunCommand } from './run';

function usage(): string {
  return [
    'linnkit v0 CLI',
    '',
    'Usage:',
    '  linnkit init <name>',
    '  linnkit doctor [--config linnkit.config.mjs]',
    '  linnkit run <agent-id> --input "..." [--model "..."] [--config linnkit.config.mjs]',
    '',
  ].join('\n');
}

function readConfigPath(options: Record<string, string | boolean>): string {
  return readStringOption(options, 'config') ?? 'linnkit.config.mjs';
}

export async function runCli(
  argv: readonly string[],
  cwd = process.cwd(),
  write: (text: string) => void = (text) => process.stdout.write(text),
  writeError: (text: string) => void = (text) => process.stderr.write(text),
): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.options.help === true || parsed.options.h === true) {
    write(usage());
    return 0;
  }

  try {
    if (parsed.command === 'init') {
      const name = parsed.positional[0];
      if (!name) throw new Error('[linnkit] init requires a project name.');
      const files = await runInitCommand({ cwd, name });
      write(`Created ${name}\n`);
      for (const file of files) {
        write(`  ${file}\n`);
      }
      write('\nNext:\n');
      write(`  cd ${name}\n`);
      write('  cp .env.example .env\n');
      write('  npm install\n');
      write('  npx linnkit doctor\n');
      return 0;
    }

    if (parsed.command === 'doctor') {
      const report = await runDoctorCommand({
        cwd,
        configPath: readConfigPath(parsed.options),
      });
      write(`${report.lines.join('\n')}\n`);
      return report.ok ? 0 : 1;
    }

    if (parsed.command === 'run') {
      const agentId = parsed.positional[0];
      if (!agentId) throw new Error('[linnkit] run requires an agent id.');
      const input = readStringOption(parsed.options, 'input');
      if (!input) throw new Error('[linnkit] run requires --input "...".');
      return await runRunCommand({
        cwd,
        configPath: readConfigPath(parsed.options),
        agentId,
        input,
        modelId: readStringOption(parsed.options, 'model'),
        write,
      });
    }

    throw new Error(`[linnkit] unknown command: ${parsed.command}`);
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
