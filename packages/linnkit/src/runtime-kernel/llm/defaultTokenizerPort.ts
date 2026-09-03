// 中文备注：这是 runtime-kernel/llm 的公开 re-export 桥，真实实现放在 shared/defaultTokenizerPort.ts；不要在这里写实现。
export {
  DefaultTokenizerPort,
  createDefaultTokenizerPort,
} from '../../shared/defaultTokenizerPort';
export type { DefaultTokenizerPortConfig } from '../../shared/defaultTokenizerPort';
