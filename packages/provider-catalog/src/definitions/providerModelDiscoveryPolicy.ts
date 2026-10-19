/** Host-only 列表能力，与推理 route 分开声明；无声明就不承诺联网发现。 */
export interface ProviderModelDiscoveryPolicy {
  readonly protocol: 'openai' | 'anthropic' | 'deepseek' | 'ollama';
  /** 多协议产品的新 ID 必须先随目录发布审查，不能套用默认 route。 */
  readonly requires_bundled_model?: true;
}
