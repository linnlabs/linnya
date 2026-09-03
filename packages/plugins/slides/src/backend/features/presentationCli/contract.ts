/**
 * Slides CLI 的纯参数合同公共入口。
 *
 * 该入口只暴露无 Electron、数据库或 coordinator 副作用的 parser，供仓库级
 * Skill guard 校验文档命令；完整 CLI 装配仍由本 feature 的 index.ts 所有。
 */
export { parseSlidesCliArgs } from './functions/parseSlidesCliArgs';
export type {
  SlidesCliCommand,
  SlidesCliInvocation,
} from './definitions/slidesCli';
