import { backendPlugin as original } from '../../../src/backend/index';
import type { CanvasCliObservationBuild } from './definitions';
import { createCanvasCliObservation } from './createCanvasCliObservation';
import { observeCanvasPluginCli } from './observeCanvasPluginCli';

// 只由开发构建define注入固定证据目录/原件哈希，不从Host context或环境读取凭据。
declare const CANVAS_CLI_OBSERVATION_BUILD: CanvasCliObservationBuild;
const observation = createCanvasCliObservation(CANVAS_CLI_OBSERVATION_BUILD);
process.once('exit', code => observation.seal(code));

// 构建仅把这个typed源入口映射到同目录index.production.cjs，不重复bundle生产实现。
export * from '../../../src/backend/index';
export const backendPlugin = observeCanvasPluginCli(original, observation);
