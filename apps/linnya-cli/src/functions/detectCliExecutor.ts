/**
 * 从调用 `linnya` 的 Agent 留在进程环境里的标记，认出是哪一家在用。
 *
 * 只收实测确认过的标记（2026-11-28：Claude Code 2.1 设 `CLAUDECODE`，Codex CLI 0.170 设 `CODEX_THREAD_ID`）。
 * 认不出来就不报名称，界面照旧显示 Linnya CLI；没有标记的 Agent 可以用 `--executor` 显式给。
 *
 * 一个 Agent 里再启动另一个 Agent 时，内层会继承外层的标记，两家标记同时存在，
 * 从环境分不出真正发起调用的是哪一个。这时不猜，按认不出来处理。
 * 通用的 `AI_AGENT` 同样会被继承，取值格式也不是各家的稳定约定，所以不用它。
 *
 * 认出的名称只是显示用的标签，不参与任何权限判断。
 */
const AGENT_ENVIRONMENT_MARKERS = [
  { name: 'Claude Code', variable: 'CLAUDECODE' },
  { name: 'Codex', variable: 'CODEX_THREAD_ID' },
] as const;

/** 测试等需要干净环境的调用方用它清掉这些标记。 */
export const AGENT_ENVIRONMENT_VARIABLES: readonly string[] = AGENT_ENVIRONMENT_MARKERS.map(marker => marker.variable);

export function detectCliExecutor(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const present = AGENT_ENVIRONMENT_MARKERS.filter(marker => Boolean(env[marker.variable]));
  return present.length === 1 ? present[0]?.name : undefined;
}
