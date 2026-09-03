/**
 * @file src/types/lodash-es.d.ts
 *
 * @brief 为 `lodash-es` 提供最小可用的类型声明（仅覆盖当前项目用到的 debounce）。
 *
 * 说明：
 * - 这里不做 any 类型断言，仅提供通用泛型签名。
 * - 如果未来引入更多 lodash-es 能力，请按实际使用补充对应声明，避免过宽的类型。
 */

declare module 'lodash-es' {
  export interface DebouncedFunc<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T> | undefined;
    cancel(): void;
    flush(): ReturnType<T>;
  }

  export interface DebounceSettings {
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
  }

  export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait?: number,
    options?: DebounceSettings
  ): DebouncedFunc<T>;
}


