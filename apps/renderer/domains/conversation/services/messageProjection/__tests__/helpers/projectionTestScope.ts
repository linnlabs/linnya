import type { SSEExecutionScope } from '@linnlabs/linnkit/contracts';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

/** 测试中的在途事件必须像真实 Host 一样显式携带执行身份。 */
export const PROJECTION_TEST_SCOPE = {
  run_id: RunIdSchema.parse('run_projection_test'),
  execution_id: 'execution_projection_test',
} satisfies SSEExecutionScope;
