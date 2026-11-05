/**
 * 数据库启动阶段的进度事实，从 App Server 经控制协议交给 Desktop Host。
 *
 * - `started` / `finished` 每次启动各一次，覆盖打开库、Host 迁移、插件迁移与建索引。
 *   宿主据此在这一阶段暂停“启动 30 秒未就绪即终止”的限制：数据多的库升级可能需要几分钟，
 *   中途终止只会让当前步骤回滚、下次启动重来。
 * - `upgrading` 表示这次有 Host 数据格式升级；只有升级时宿主才可能显示“正在升级数据”。
 * - 步骤按 Host 迁移逐步计数，插件迁移与建索引合为最后一步；不提供剩余时间估计。
 */
export interface DatabaseStartupProgressEvent {
  readonly state: 'started' | 'progress' | 'finished';
  readonly upgrading: boolean;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface DatabaseStartupProgressPort {
  /** resolve 表示事件已交给宿主（已写入控制管道），之后才开始可能很久的同步步骤。 */
  report(event: DatabaseStartupProgressEvent): Promise<void>;
}
