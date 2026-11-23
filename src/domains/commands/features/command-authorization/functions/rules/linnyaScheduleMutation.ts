const AUTOMATION_OPERATIONS = new Set(['create', 'update', 'resume', 'run-now']);

export function isLinnyaScheduleMutation(fact: { executable: string | undefined; executableTokens: readonly string[] }): boolean {
  const [, namespace, action] = fact.executableTokens;
  return ['linnya', 'linnya.exe', 'linnya.cmd', 'linnya.ps1'].some(name => name === fact.executable)
    && namespace === 'schedules'
    && AUTOMATION_OPERATIONS.has(action);
}
