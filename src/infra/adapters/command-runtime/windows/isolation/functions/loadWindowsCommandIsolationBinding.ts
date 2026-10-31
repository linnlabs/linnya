import { WindowsNativeRuntimeLoadError } from '../../../../local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';
import { wrapNativeProcess } from '../../../../local-process-runtime/windows/functions/loadWindowsOwnedPipeNativeBinding';
import { createVerifiedWindowsNativeRuntimeModuleLoader, type WindowsNativeRuntimeModuleLoaderOptions } from '../../../../local-process-runtime/windows/functions/loadVerifiedWindowsNativeRuntimeModule';
import { asWindowsNativeObject, readWindowsNativeMethod, type WindowsNativeUnknownMethod } from '../../../../local-process-runtime/windows/functions/windowsNativeBindingContract';
import { wrapNativePtyProcess } from '../../functions/loadWindowsOwnedPtyNativeBinding';
import type { WindowsCommandIsolationBinding } from '../definitions/windowsCommandIsolation';

function callPreparation(record: object, method: WindowsNativeUnknownMethod, args: unknown[]): Promise<unknown> {
  const result: unknown = Reflect.apply(method, record, args);
  const promise = asWindowsNativeObject(result);
  if (!promise || typeof Reflect.get(promise, 'then') !== 'function') {
    throw new WindowsNativeRuntimeLoadError('binding_contract_invalid', 'Windows isolated preparation must return a Promise');
  }
  return Promise.resolve(result);
}

/** 普通 native owner 合同保持独立；受限模式必须具备两个隔离工厂，缺失即拒绝执行。 */
export function createWindowsCommandIsolationBindingLoader(options: WindowsNativeRuntimeModuleLoaderOptions): {
  load(): Promise<WindowsCommandIsolationBinding>;
} {
  const loader = createVerifiedWindowsNativeRuntimeModuleLoader(options);
  let prepared: Promise<WindowsCommandIsolationBinding> | undefined;
  return {
    load() {
      prepared ??= loader.load().then((module): WindowsCommandIsolationBinding => {
        const record = asWindowsNativeObject(module);
        if (!record) throw new WindowsNativeRuntimeLoadError('binding_contract_invalid', 'Windows isolation binding must be an object');
        const pipe = readWindowsNativeMethod(record, 'createWindowsIsolatedPipeProcess');
        const pty = readWindowsNativeMethod(record, 'createWindowsIsolatedPtyProcess');
        return Object.freeze({
          createPipe: (input, isolation) => callPreparation(record, pipe, [input, isolation]).then(wrapNativeProcess),
          createPty: (input, isolation, columns, rows) => callPreparation(record, pty, [input, isolation, columns, rows]).then(wrapNativePtyProcess),
        } satisfies WindowsCommandIsolationBinding);
      });
      return prepared;
    },
  };
}
