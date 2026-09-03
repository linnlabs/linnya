export class AppShutdownStagesError extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super('应用退出时存在未完成的收口步骤');
    this.name = 'AppShutdownStagesError';
  }
}

/** 各 owner 独立收口；前一项失败不能跳过后续命令 owner。 */
export async function runAppShutdownStages(
  stages: readonly (() => Promise<void>)[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const stage of stages) {
    try {
      await stage();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AppShutdownStagesError(failures);
}
