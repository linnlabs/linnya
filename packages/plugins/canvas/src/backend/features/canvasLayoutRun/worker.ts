import type { CanvasLayoutRequest } from '../../../shared';
import { planCanvasLayout } from './functions/planCanvasLayout';
import { layoutCanvasLayered } from './adapters/elk/layoutCanvasLayered';

/** 只供插件的后台计算组合入口使用；普通Backend入口不导出或加载ELK。 */
export function executeCanvasLayout(request: CanvasLayoutRequest) { return planCanvasLayout(request, layoutCanvasLayered); }
