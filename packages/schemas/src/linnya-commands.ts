/**
 * `linnya` 的命令目录：外部终端里的对话控制命令，与 Linnya 对话 Shell 里的内建命令，同名同一棵树。
 *
 * 两处入口各自实现自己的命令，但共用这一份目录：`linnya --help` 的总览两边一字不差，
 * 在错误的环境调用时也据此给出“该去哪里用”，而不是报未知命令。
 * 新增或删除命令时在这里登记；两处入口各有一条测试核对目录与实际分发一致。
 */
export type LinnyaCommandEnvironment = 'terminal' | 'agent_shell';

export interface LinnyaCommandEntry {
  readonly name: string;
  readonly environment: LinnyaCommandEnvironment;
  readonly summary: string;
}

export const LINNYA_COMMANDS: readonly LinnyaCommandEntry[] = [
  { name: 'doctor', environment: 'terminal', summary: 'Check the CLI build, the App connection and its capabilities' },
  { name: 'runtime', environment: 'terminal', summary: 'Start a source Runtime without the desktop window' },
  { name: 'projects', environment: 'terminal', summary: 'List, create, update or delete projects' },
  { name: 'models', environment: 'terminal', summary: 'List the models the App can use' },
  { name: 'send', environment: 'terminal', summary: 'Send a message to a Linnya agent' },
  { name: 'status', environment: 'terminal', summary: 'Read or watch the state of a run' },
  { name: 'result', environment: 'terminal', summary: 'Read the final answer of a run' },
  { name: 'respond', environment: 'terminal', summary: 'Answer a question the agent asked' },
  { name: 'approvals', environment: 'terminal', summary: 'List command approvals a run is waiting for' },
  { name: 'approval-reply', environment: 'terminal', summary: 'Deny a command approval, or allow it when the user permits' },
  { name: 'resume', environment: 'terminal', summary: 'Resume a settled paused run' },
  { name: 'stop', environment: 'terminal', summary: 'Stop a run' },
  { name: 'list', environment: 'terminal', summary: 'List conversations' },
  { name: 'messages', environment: 'terminal', summary: 'Read the messages of a conversation' },
  { name: 'tools', environment: 'terminal', summary: 'Call workspace tools and plugin commands without a model' },
  { name: 'skills', environment: 'terminal', summary: 'Manage the skills Linnya agents can load' },
  { name: 'audit', environment: 'terminal', summary: 'Export or configure the execution audit (source builds)' },
  { name: 'changes', environment: 'agent_shell', summary: 'List document changes kept for the current project' },
  { name: 'conversations', environment: 'agent_shell', summary: 'Read other conversations of the current project' },
  { name: 'schema', environment: 'agent_shell', summary: 'Read or change tags and their fields' },
  { name: 'props', environment: 'agent_shell', summary: 'Read or set the tags and field values of a document' },
  { name: 'query', environment: 'agent_shell', summary: 'Find documents by tags and field values' },
  { name: 'links', environment: 'agent_shell', summary: 'Read references between documents' },
  { name: 'palette', environment: 'agent_shell', summary: 'Suggest, check and record colour palettes' },
  { name: 'image', environment: 'agent_shell', summary: 'Process images in the conversation directory' },
  { name: 'schedules', environment: 'agent_shell', summary: 'Manage scheduled tasks' },
];

const ENVIRONMENT_LABEL: Readonly<Record<LinnyaCommandEnvironment, string>> = {
  terminal: 'In a terminal outside Linnya (drives the running App)',
  agent_shell: "Inside a Linnya conversation (the agent's shell)",
};

export function findLinnyaCommand(name: string): LinnyaCommandEntry | undefined {
  return LINNYA_COMMANDS.find(command => command.name === name);
}

/** 两处 `linnya --help` 共用的总览；`current` 只决定哪一组标成“这里可用”。 */
export function formatLinnyaCommandOverview(current: LinnyaCommandEnvironment): string {
  const width = Math.max(...LINNYA_COMMANDS.map(command => command.name.length));
  const environments: readonly LinnyaCommandEnvironment[] = ['terminal', 'agent_shell'];
  const sections = environments.map(environment => [
    `  ${ENVIRONMENT_LABEL[environment]} - ${environment === current ? 'available here' : 'not available here'}:`,
    ...LINNYA_COMMANDS
      .filter(command => command.environment === environment)
      .map(command => `    ${command.name.padEnd(width)}  ${command.summary}`),
  ].join('\n'));
  return [
    'All linnya commands:',
    ...sections,
    "  Plugin commands (linnya-<plugin>, for example linnya-slides) run in the agent's shell;",
    '  from a terminal, run them with: linnya tools call plugin_cli',
  ].join('\n');
}

/** 在错误的环境调用了另一边的命令时的指引。 */
export function describeLinnyaCommandElsewhere(command: LinnyaCommandEntry): string {
  return command.environment === 'agent_shell'
    ? `linnya ${command.name} is available only inside a Linnya conversation (the agent's shell), not in this terminal. `
      + 'To use it from here, ask a Linnya agent with: linnya send "<what you need>" --project ID. '
      + 'Run linnya --help to see which commands work where.'
    : `linnya ${command.name} is a terminal command for driving Linnya from outside; it is not available inside a conversation's shell. `
      + 'Run linnya --help to see which commands work here.';
}
