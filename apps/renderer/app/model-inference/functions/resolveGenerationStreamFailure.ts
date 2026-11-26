import {
  GenerationStreamError,
  type GenerationStreamTerminalFacts,
} from '../definitions/generationStream';

/**
 * 判断一条已读完的生成流是否失败。
 *
 * Host 对每次接纳的执行都以 transport_end 收尾：运行出错会先发 error，再以 reason=error 收尾；
 * 接纳前就失败（例如会话不存在、运行登记被拒）时 Router 只记日志就关流，连 transport_end 都没有。
 * 所以“没有收尾事件”本身就是失败，不能当成“模型什么也没说”返回空文字。
 */
export function resolveGenerationStreamFailure(
  facts: GenerationStreamTerminalFacts,
): GenerationStreamError | undefined {
  if (facts.firstError) {
    return new GenerationStreamError(facts.firstError.error, 'run_error', facts.firstError.error_code);
  }
  if (!facts.transportEnd) {
    return new GenerationStreamError('Generation stream closed before transport_end', 'unexpected_eof');
  }
  // Host 总会写明收尾原因；只有 complete 才算生成成功。
  const { reason, reason_message: reasonMessage } = facts.transportEnd;
  if (reason !== 'complete') {
    return new GenerationStreamError(
      reasonMessage ?? `Generation stream ended with reason ${reason ?? 'unspecified'}`,
      'transport_end_not_complete',
    );
  }
  return undefined;
}
