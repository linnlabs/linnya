import type { HostProcessEnvironment } from '../definitions';

/** App owner 只在启动边界读取一次 process.env，后续模块只能接收冻结合同。 */
export function createHostProcessEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HostProcessEnvironment {
  const entries = Object.freeze(Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  ));
  return Object.freeze({ kind: 'host_process_environment', entries });
}
