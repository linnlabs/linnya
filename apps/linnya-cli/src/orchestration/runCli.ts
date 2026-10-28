import { readFile } from 'node:fs/promises';
import { ConversationControlToolsCallRequestSchema } from '@app/schemas';
import { ZodError } from 'zod';
import type { ConversationControlProgressFrame } from '@app/schemas';
import {
  LINNYA_CLI_EXIT,
  LINNYA_CLI_VERSION,
  LINNYA_CLI_BUILD_ID,
  LinnyaCliError,
  type ConversationControlConnectionPort,
  type LinnyaCliIo,
  type LinnyaCliRuntimeLauncherPort,
} from '../definitions/cli';
import { createBundledCliRuntimeLauncher } from '../adapters/bundledCliRuntimeLauncher';
import { parseCliInvocation } from '../functions/parseCliInvocation';
import { exitCodeForError, projectCliError } from '../functions/projectCliError';
import { createConversationControlConnection } from './createConversationControlConnection';
import { watchConversationStatus } from './watchConversationStatus';
import { executeToolCall } from './executeToolCall';
import { stopConversationRun } from './stopConversationRun';
import { resumeConversationRun } from './resumeConversationRun';

interface RunCliOptions {
  readonly connection?: ConversationControlConnectionPort;
  readonly io?: LinnyaCliIo;
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly runtimeLauncher?: LinnyaCliRuntimeLauncherPort;
}

export function linnyaCliUsage(): string {
  return [
    'Linnya conversation CLI',
    '',
    'Usage:',
    '  linnya doctor [--pretty]   Check CLI build, App connection, protocol and capabilities (read-only)',
    '  linnya runtime start [--workspace PATH] [--api-port PORT] [--qdrant-port PORT]',
    '  linnya --version          Show version and source/bundle build identity',
    '  linnya --help             Show this help (also -h or <command> --help)',
    '  linnya send <message> --project ID [--conversation ID] [--agent ID] [--model ID] [--image-model ID] [--reasoning LEVEL]',
    '    Research: --agent research_v1; optional --research-scope-json JSON for explicit material scope (question, reader, task_type, materials, optional time_range)',
    '  linnya skills list | read NAME [PATH] | validate DIRECTORY',
    '  linnya skills install|update NAME --from DIRECTORY',
    '  linnya skills remove NAME',
    '  linnya skills edit NAME [PATH] --old TEXT --new TEXT',
    '  linnya skills write NAME [PATH] --from FILE [--create]',
    '  linnya models',
    '  linnya projects [list]',
    '  linnya projects get <project-id>',
    '  linnya projects create <name> [--description TEXT]',
    '  linnya projects update <project-id> [--name NAME] [--description TEXT]',
    '  linnya projects delete <project-id> --yes',
    '  linnya list [--limit N] [--cursor CURSOR] [--search TEXT] [--project ID]',
    '  linnya messages <conversation-id> [--before N | --after N] [--limit N]',
    '  linnya status <conversation-id> [--run ID] [--watch] [--interval MS] [--timeout MS]',
    '  linnya resume <conversation-id> --run ID [--timeout MS]',
    '  linnya approvals <conversation-id> --run ID',
    '  linnya approval-reply <conversation-id> --run ACTUAL_RUN_ID --request ID --choice allow_once|allow_for_conversation|deny',
    '  linnya respond <conversation-id> --interaction ID (--approve | --skip | --submit-json JSON | --modify-json JSON) [--project ID]',
    '  linnya stop <conversation-id> [--run ID] [--reason TEXT] [--timeout MS]',
    '  linnya result <conversation-id> [--run ID]',
    '  linnya audit <conversation-id> [--run ID]',
    '  linnya tools list',
    '  linnya tools web <on|off|status>',
    '  linnya tools describe <tool-name>',
    '  linnya tools call <tool-name> (--conversation ID | --project ID) [--args-json JSON | --args-file PATH] [--omit-args] [--interval MS] [--timeout MS]',
    '',
    'Output:',
    '  Single commands write one JSON value to stdout. status --watch writes JSONL frames.',
    '  Errors write one stable JSON value to stderr. --pretty is available for single commands.',
    '',
    'Workflow:',
    '  list without --project shows unprojected conversations only, not a global list.',
    '  Run doctor, projects and models first; use the returned project/model IDs with send.',
    '  An empty Workspace can use projects create NAME before send. Creating or updating a project preserves the Desktop selection.',
    '  projects update requires at least one field; --description="" clears the description.',
    '  projects delete --yes deletes an empty ordinary project only. Linked content, including deleted history, blocks deletion; there is no --force.',
    '  Non-empty projects must be deleted manually by the user in the Linnya desktop app; do not clear their content to retry CLI deletion.',
    '  Save receipt.conversation_id and receipt.run_id, then status <conversation-id> --run <run-id> --watch.',
    '  send always requires --project; with --conversation it must match the saved project. The saved Agent is inherited unless --agent is supplied.',
    '  stop --run is safe to repeat and waits for tool/persistence settlement (default 60000ms).',
    '  resume requires an exact settled paused run; awaiting_user must use respond.',
    '  Shell approval is separate from respond: use approvals to inspect exact run/subtree requests, then approval-reply with the pending agent_run_id.',
    '  status --watch returns when command_approvals contains awaiting_reply; it never auto-approves commands.',
    '  A watch timeout only ends observation; it does not stop the App-owned run.',
    '',
  ].join('\n');
}

function serialize(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const io = options.io ?? {
    write: text => process.stdout.write(text),
    writeError: text => process.stderr.write(text),
  };

  try {
    let invocation;
    try {
      invocation = parseCliInvocation(argv);
      if (invocation.kind === 'tool-call' && invocation.argsFile) {
        let args: unknown;
        try {
          args = JSON.parse(await readFile(invocation.argsFile, 'utf8'));
        } catch {
          throw new LinnyaCliError('invalid_request', '--args-file must name a readable UTF-8 JSON file');
        }
        invocation = { ...invocation, request: ConversationControlToolsCallRequestSchema.parse({
          ...invocation.request, args,
        }) };
      }
    } catch (error: unknown) {
      if (error instanceof LinnyaCliError) throw error;
      if (error instanceof ZodError) {
        throw new LinnyaCliError(
          'invalid_request',
          error.issues[0]?.message ?? 'Invalid CLI arguments',
        );
      }
      throw error;
    }

    if (invocation.kind === 'help') {
      io.write(linnyaCliUsage());
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'version') {
      io.write(`${LINNYA_CLI_VERSION} (${LINNYA_CLI_BUILD_ID === 'source' ? 'source' : `bundle ${LINNYA_CLI_BUILD_ID}`})\n`);
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'runtime-start') {
      const launcher = options.runtimeLauncher ?? createBundledCliRuntimeLauncher();
      await launcher.run({
        workspaceDirectory: invocation.workspaceDirectory,
        apiPort: invocation.apiPort,
        qdrantPort: invocation.qdrantPort,
        onReady(identity) {
          io.write(serialize({
            schema_version: 1,
            ok: true,
            command: 'runtime',
            state: 'ready',
            runtime: {
              pid: identity.pid,
              application_version: identity.applicationVersion,
              api_port: identity.apiPort,
              database_ready: identity.databaseReady,
            },
          }, invocation.pretty));
        },
      });
      return LINNYA_CLI_EXIT.success;
    }

    const client = await (options.connection ?? createConversationControlConnection()).connect();
    if (invocation.kind === 'skill-write') {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(invocation.file));
      let expected: string | null = null;
      if (!invocation.create) {
        const previous = await client.execute({ schema_version: 1, command: 'skills',
          request: { action: 'read', name: invocation.name, path: invocation.path } });
        if (previous.command !== 'skills' || previous.result.action !== 'read') {
          throw new LinnyaCliError('protocol_incompatible', 'Expected skill file content');
        }
        expected = previous.result.content;
      }
      const response = await client.execute({ schema_version: 1, command: 'skills',
        request: { action: 'write', name: invocation.name, path: invocation.path,
          content, expected_content: expected } });
      io.write(serialize(response, invocation.pretty));
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'doctor') {
      io.write(serialize({
        schema_version: 1, ok: true, command: 'doctor',
        cli: { version: LINNYA_CLI_VERSION, build_id: LINNYA_CLI_BUILD_ID,
          mode: LINNYA_CLI_BUILD_ID === 'source' ? 'source' : 'bundle' },
        app: { version: client.handshake.app_version, instance_id: client.handshake.app_instance_id },
        protocol_version: client.handshake.protocol_version,
        capabilities: client.handshake.capabilities,
        limits: client.handshake.limits,
      }, invocation.pretty));
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'stop') {
      const response = await stopConversationRun({ client, request: invocation.request,
        timeoutMs: invocation.timeoutMs, now: options.now });
      io.write(serialize(response, invocation.pretty));
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'resume') {
      const response = await resumeConversationRun({
        client,
        conversationId: invocation.conversationId,
        runId: invocation.runId,
        timeoutMs: invocation.timeoutMs,
      });
      io.write(serialize(response, invocation.pretty));
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'tool-call') {
      const result = await executeToolCall({
        client,
        request: invocation.request,
        intervalMs: invocation.intervalMs,
        timeoutMs: invocation.timeoutMs,
        now: options.now,
        sleep: options.sleep,
      });
      // 裁剪只影响此次 CLI 输出，不能改写 durable 工具卡或移除错误证据。
      const outputResult = invocation.omitArgs
        ? { ...result, tool: { ...result.tool, payload: { ...result.tool.payload, args: undefined } } }
        : result;
      const output = serialize(outputResult, invocation.pretty);
      if (result.ok) {
        io.write(output);
        return LINNYA_CLI_EXIT.success;
      }
      io.writeError(output);
      return LINNYA_CLI_EXIT.internal;
    }
    if (invocation.kind === 'status' && invocation.watch) {
      await watchConversationStatus({
        client,
        request: invocation.request,
        intervalMs: invocation.intervalMs,
        timeoutMs: invocation.timeoutMs,
        writeFrame: (frame: ConversationControlProgressFrame) => io.write(serialize(frame, false)),
        now: options.now,
        sleep: options.sleep,
      });
      return LINNYA_CLI_EXIT.success;
    }

    const response = await client.execute(invocation.request);
    io.write(serialize(response, invocation.pretty));
    // 传输成功不等于审批被接纳；竞争窗口里已结算的请求不能被脚本记成获准。
    if (response.command === 'command_approvals' && response.action === 'reply'
      && response.status === 'stale') return LINNYA_CLI_EXIT.conflict;
    return LINNYA_CLI_EXIT.success;
  } catch (error: unknown) {
    const projected = projectCliError(error);
    io.writeError(serialize(projected, false));
    return exitCodeForError(projected.error.code);
  }
}
