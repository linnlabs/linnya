/** 独立浏览器 fixture 只使用组件自带文案，不启动 Host 的语言偏好存储。 */
export function useLocalization() {
  return { message: (_key: string, fallback: string) => fallback };
}
