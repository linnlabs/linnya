import { parseArgs } from 'node:util';
import type { ConversationFileLocator } from '@app/schemas/file-locator';
import { isSlideRasterSquareEnvelopeWithinBudget } from '@plugin/slides/shared/slideRasterization';
import {
  SlidesCliError,
  SlidesCliExitCode,
  type SlidesCliCommand,
  type SlidesCliInvocation,
} from '../definitions/slidesCli';

const HELP = `Linnya Slides CLI

Usage:
  slides render --presentation <id> --output <directory> [options]
  slides inspect --presentation <id> [options]
  slides export --presentation <id>        (inside Linnya only)
  slides fonts list --script <latin|eastAsian|complex> [--target <office|local>] [--limit <number>] [--offset <number>]
  slides fonts check --family <name>

Font options:
  --target office         List fonts PowerPoint opens on both Windows and Mac (default)
  --target local          List fonts installed on this computer (supports --limit/--offset)

Common options:
  --database <path>       Workspace SQLite path (defaults to the active workspace)
  --slide <number>        Select one slide (1-based)
  --from <number>         Select range start (requires --to)
  --to <number>           Select range end (requires --from)
  --format <json|pretty>  JSON formatting for all commands (default: json)
  --help                  Show this help

Render options:
  --output <directory>    Standalone output root for JPEG review images
  --width <pixels>        CSS viewport width (default: 1600)
  --pixel-ratio <number>  Raster pixel ratio (default: 1)
  --overwrite             Replace selected files in a standalone output directory

Export:
  Writes the latest successful version as an editable .pptx into the conversation directory
  (slides-exports/). Available through linnya-slides in Linnya's shell or the plugin_cli tool of
  the linnya command; the standalone CLI reads the database read-only and cannot export.

Inspect options:
  --max-slides <number>   Limit returned pages and mark the report truncated
  --heuristics            Include Tier-2 low-confidence hints
  --source-range <a:b>    Focus on an inclusive deck.js line range (repeat up to 4 times)

Font options:
  --family <name>         Exact font family name to check
  --script <script>       Candidate script: latin, eastAsian, or complex
  --limit <number>        Candidate page size (default: 30, maximum: 100)
  --offset <number>       Candidate page offset (default: 0)

Automation contract:
  render: stdout is one compact JSON report containing the presentation version and JPEG locators.
  exit status: a non-zero exit code means the command failed; do not pipe render through
  tail/|| true when checking whether rendering succeeded.
  inspect: stdout is one compact JSON report; operational logs go to stderr.
  export: stdout is one compact JSON report with the version number and the .pptx locator.
  Linux execution requires DISPLAY or WAYLAND_DISPLAY (for CI, run under Xvfb).
`;

export function parseSlidesCliArgs(
  argv: readonly string[],
  options: {
    readonly resolveManagedRenderOutput?: (presentationId: string) => {
      readonly root: string;
      readonly directoryReference: ConversationFileLocator;
    };
    /** 只有 Linnya App 内的调用提供；缺省时 export 不可用。 */
    readonly resolveManagedExportOutput?: (presentationId: string) => {
      readonly root: string;
      readonly directoryReference: ConversationFileLocator;
    };
  } = {},
): SlidesCliInvocation {
  const commandName = argv[0];
  if (commandName === undefined || commandName === '--help' || commandName === '-h') {
    return { kind: 'help', text: HELP };
  }
  if (commandName === 'fonts') {
    return parseFontCommand(argv.slice(1));
  }
  if (commandName === 'export') {
    return parseExportCommand(argv.slice(1), options.resolveManagedExportOutput);
  }
  if (commandName !== 'render' && commandName !== 'inspect') {
    throw usageError('Expected one of: render, inspect, export, fonts');
  }

  const parsed = parseCommandOptionsOrUsageError(argv.slice(1), 'Invalid command options');

  if (parsed.values.help === true) {
    return { kind: 'help', text: HELP };
  }
  if (
    parsed.values.family !== undefined
    || parsed.values.script !== undefined
    || parsed.values.target !== undefined
    || parsed.values.limit !== undefined
    || parsed.values.offset !== undefined
  ) {
    throw usageError('--family, --script, --target, --limit and --offset are fonts options');
  }
  const presentationId = requireNonEmpty(parsed.values.presentation, '--presentation');
  const databasePath = readOptionalNonEmpty(parsed.values.database, '--database');
  const selection = parseSelection(parsed.values.slide, parsed.values.from, parsed.values.to);

  if (commandName === 'render') {
    if (
      parsed.values['max-slides'] !== undefined
      || parsed.values.heuristics === true
      || parsed.values['source-range'] !== undefined
    ) {
      throw usageError('--max-slides, --heuristics and --source-range are not render options');
    }
    if (
      options.resolveManagedRenderOutput
      && (parsed.values.output !== undefined || parsed.values.overwrite === true)
    ) {
      throw usageError('--output and --overwrite are managed by the Linnya Slides host');
    }
    const managedOutput = options.resolveManagedRenderOutput?.(presentationId);
    const outputRoot = managedOutput?.root
      ?? requireNonEmpty(parsed.values.output, '--output');
    const viewportWidthPx = readPositiveNumber(parsed.values.width, '--width', 1600);
    const pixelRatio = readPositiveNumber(parsed.values['pixel-ratio'], '--pixel-ratio', 1);
    if (!isSlideRasterSquareEnvelopeWithinBudget({ viewportWidthPx, pixelRatio })) {
      throw usageError('--width and --pixel-ratio exceed the screenshot pixel budget');
    }
    const command: SlidesCliCommand = {
      kind: 'render',
      format: readOutputFormat(parsed.values.format),
      ...(databasePath ? { databasePath } : {}),
      ...(managedOutput
        ? { outputDirectoryReference: managedOutput.directoryReference }
        : {}),
      presentationId,
      request: {
        selection,
        profile: {
          id: 'slides-cli-agent-review-v1',
          viewportWidthPx,
          pixelRatio,
        },
        encoding: { kind: 'agent_review_jpeg' },
        output: managedOutput
          ? { kind: 'latest_version', root: outputRoot }
          : {
              kind: 'directory',
              root: outputRoot,
              overwrite: parsed.values.overwrite === true,
            },
      },
    };
    return { kind: 'command', command };
  }

  if (
    parsed.values.output !== undefined
    || parsed.values.width !== undefined
    || parsed.values['pixel-ratio'] !== undefined
    || parsed.values.overwrite === true
  ) {
    throw usageError('--output, --width, --pixel-ratio and --overwrite are render options');
  }
  const maxSlides = readOptionalPositiveInteger(parsed.values['max-slides'], '--max-slides');
  const focus = parseSourceRanges(parsed.values['source-range']);
  const command: SlidesCliCommand = {
    kind: commandName,
      format: readOutputFormat(parsed.values.format),
    ...(databasePath ? { databasePath } : {}),
    presentationId,
    request: {
      selection,
      ...(maxSlides === undefined ? {} : { maxSlides }),
      includeHeuristics: parsed.values.heuristics === true,
      ...(focus.length > 0 ? { focus } : {}),
    },
  };
  return { kind: 'command', command };
}

function parseExportCommand(
  args: readonly string[],
  resolveManagedExportOutput: ((presentationId: string) => {
    readonly root: string;
    readonly directoryReference: ConversationFileLocator;
  }) | undefined,
): SlidesCliInvocation {
  const parsed = parseCommandOptionsOrUsageError(args, 'Invalid export options');
  if (parsed.values.help === true) {
    return { kind: 'help', text: HELP };
  }
  const { presentation, format, ...others } = parsed.values;
  // help 已在上面处理；其余选项都属于 render、inspect 或 fonts。
  if (Object.entries(others).some(([name, value]) => name !== 'help' && value !== undefined)) {
    throw usageError('export accepts only --presentation and --format');
  }
  if (!resolveManagedExportOutput) {
    throw usageError('export is available only inside Linnya (linnya-slides, or the plugin_cli tool of the linnya command)');
  }
  const presentationId = requireNonEmpty(presentation, '--presentation');
  return {
    kind: 'command',
    command: {
      kind: 'export',
      format: readOutputFormat(format),
      presentationId,
      output: resolveManagedExportOutput(presentationId),
    },
  };
}

function parseFontCommand(args: readonly string[]): SlidesCliInvocation {
  const action = args[0];
  if (action === undefined || action === '--help' || action === '-h') {
    return { kind: 'help', text: HELP };
  }
  if (action !== 'check' && action !== 'list') {
    throw usageError('Expected one of: fonts check, fonts list');
  }

  const parsed = parseCommandOptionsOrUsageError(args.slice(1), 'Invalid font command options');
  if (parsed.values.help === true) {
    return { kind: 'help', text: HELP };
  }

  assertOnlyFontOptions(parsed.values, action);
  if (action === 'check') {
    return {
      kind: 'command',
      command: {
        kind: 'fonts-check',
      format: readOutputFormat(parsed.values.format),
        family: requireNonEmpty(parsed.values.family, '--family'),
      },
    };
  }

  const script = parsed.values.script;
  if (script !== 'latin' && script !== 'eastAsian' && script !== 'complex') {
    throw usageError('--script must be one of: latin, eastAsian, complex');
  }
  const target = parsed.values.target ?? 'office';
  if (target !== 'office' && target !== 'local') {
    throw usageError('--target must be one of: office, local');
  }
  if (target === 'office') {
    if (parsed.values.limit !== undefined || parsed.values.offset !== undefined) {
      throw usageError('--limit and --offset require --target local');
    }
    return {
      kind: 'command',
      command: {
        kind: 'fonts-list',
        format: readOutputFormat(parsed.values.format),
        target,
        script,
      },
    };
  }
  return {
    kind: 'command',
    command: {
      kind: 'fonts-list',
      format: readOutputFormat(parsed.values.format),
      target,
      request: {
        script,
        limit: readBoundedPositiveInteger(parsed.values.limit, '--limit', 30, 100),
        offset: readNonNegativeInteger(parsed.values.offset, '--offset', 0),
      },
    },
  };
}

function parseCommandOptions(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: false,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      format: { type: 'string' },
      database: { type: 'string' },
      presentation: { type: 'string' },
      slide: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      output: { type: 'string' },
      width: { type: 'string' },
      'pixel-ratio': { type: 'string' },
      overwrite: { type: 'boolean' },
      'max-slides': { type: 'string' },
      'source-range': { type: 'string', multiple: true },
      heuristics: { type: 'boolean' },
      family: { type: 'string' },
      script: { type: 'string' },
      target: { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string' },
    },
  });
}

/**
 * 外部 Agent 只能靠报错文字自行改参数，所以把 parseArgs 的原因（例如 Unknown option '--slides'）
 * 原样附上；它只引用调用方自己传入的选项与值。不是参数解析错误的异常照常抛出，不伪装成用法错误。
 */
function parseCommandOptionsOrUsageError(
  args: readonly string[],
  summary: string,
): ReturnType<typeof parseCommandOptions> {
  try {
    return parseCommandOptions(args);
  } catch (error: unknown) {
    if (isParseArgsError(error)) throw usageError(`${summary}: ${error.message}`);
    throw error;
  }
}

function isParseArgsError(error: unknown): error is TypeError & { readonly code: string } {
  return error instanceof TypeError
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('ERR_PARSE_ARGS_');
}

function assertOnlyFontOptions(
  values: ReturnType<typeof parseCommandOptions>['values'],
  action: 'check' | 'list',
): void {
  const presentationOptions = [
    values.database,
    values.presentation,
    values.slide,
    values.from,
    values.to,
    values.output,
    values.width,
    values['pixel-ratio'],
    values['max-slides'],
    values['source-range'],
  ];
  if (presentationOptions.some((value) => value !== undefined)
    || values.overwrite === true
    || values.heuristics === true) {
    throw usageError('Presentation options are not available for fonts commands');
  }
  if (action === 'check' && (
    values.script !== undefined
    || values.target !== undefined
    || values.limit !== undefined
    || values.offset !== undefined
  )) {
    throw usageError('--script, --target, --limit and --offset require fonts list');
  }
  if (action === 'list' && values.family !== undefined) {
    throw usageError('--family requires fonts check');
  }
}

function parseSourceRanges(values: readonly string[] | undefined) {
  if (values === undefined) return [];
  if (values.length > 4) {
    throw usageError('--source-range may be repeated at most 4 times');
  }
  return values.map((value) => {
    const match = /^(\d+):(\d+)$/.exec(value.trim());
    if (!match) throw usageError('--source-range must use start:end positive inclusive lines');
    const startLine = readPositiveInteger(match[1]!, '--source-range start');
    const endLine = readPositiveInteger(match[2]!, '--source-range end');
    if (endLine < startLine) {
      throw usageError('--source-range end cannot be smaller than start');
    }
    return { startLine, endLine };
  });
}

function parseSelection(
  slideValue: string | undefined,
  fromValue: string | undefined,
  toValue: string | undefined,
) {
  if (slideValue !== undefined && (fromValue !== undefined || toValue !== undefined)) {
    throw usageError('--slide cannot be combined with --from or --to');
  }
  if ((fromValue === undefined) !== (toValue === undefined)) {
    throw usageError('--from and --to must be provided together');
  }
  if (slideValue !== undefined) {
    return { kind: 'single' as const, slideNumber: readPositiveInteger(slideValue, '--slide') };
  }
  if (fromValue !== undefined && toValue !== undefined) {
    const fromSlideNumber = readPositiveInteger(fromValue, '--from');
    const toSlideNumber = readPositiveInteger(toValue, '--to');
    if (toSlideNumber < fromSlideNumber) {
      throw usageError('--to cannot be smaller than --from');
    }
    return { kind: 'range' as const, fromSlideNumber, toSlideNumber };
  }
  return { kind: 'all' as const };
}

function requireNonEmpty(value: string | undefined, option: string): string {
  const normalized = readOptionalNonEmpty(value, option);
  if (normalized === undefined) {
    throw usageError(`${option} is required`);
  }
  return normalized;
}

function readOptionalNonEmpty(value: string | undefined, option: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    throw usageError(`${option} cannot be empty`);
  }
  return normalized;
}

function readPositiveInteger(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw usageError(`${option} must be a positive integer`);
  }
  return number;
}

function readOptionalPositiveInteger(
  value: string | undefined,
  option: string,
): number | undefined {
  return value === undefined ? undefined : readPositiveInteger(value, option);
}

function readBoundedPositiveInteger(
  value: string | undefined,
  option: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const number = readPositiveInteger(value, option);
  if (number > maximum) {
    throw usageError(`${option} must not exceed ${maximum}`);
  }
  return number;
}

function readNonNegativeInteger(
  value: string | undefined,
  option: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw usageError(`${option} must be a non-negative integer`);
  }
  return number;
}

function readPositiveNumber(value: string | undefined, option: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw usageError(`${option} must be a positive number`);
  }
  return number;
}

function usageError(message: string): SlidesCliError {
  return new SlidesCliError(
    'slides.cli.invalid_arguments',
    SlidesCliExitCode.INVALID_ARGUMENTS,
    message,
  );
}

function readOutputFormat(value: string | undefined): 'json' | 'pretty' | undefined {
  if (value === undefined || value === 'json' || value === 'pretty') return value;
  throw usageError('--format must be json or pretty');
}
