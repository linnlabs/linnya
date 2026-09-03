export interface ParsedCli {
  command?: string;
  positional: string[];
  options: Record<string, string | boolean>;
}

export function parseCliArgs(argv: readonly string[]): ParsedCli {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const raw = token.slice(2);
      const eqIndex = raw.indexOf('=');
      if (eqIndex >= 0) {
        options[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[raw] = next;
        index += 1;
      } else {
        options[raw] = true;
      }
      continue;
    }
    positional.push(token);
  }

  const [command, ...rest] = positional;
  return { command, positional: rest, options };
}

export function readStringOption(
  options: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
