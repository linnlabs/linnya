import type { WindowsOwnedPipeNativeLaunchInput } from '../../../local-process-runtime/windows';
import { WindowsNativeRuntimeLoadError } from '../../../local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';
import {
  asWindowsNativeObject,
  callWindowsNativeIntegerPromiseMethod,
  callWindowsNativePromiseMethod,
  callWindowsNativeVoidMethod,
  readWindowsNativeMethod,
} from '../../../local-process-runtime/windows/functions/windowsNativeBindingContract';
import {
  createVerifiedWindowsNativeRuntimeModuleLoader,
  type WindowsNativeRuntimeModuleLoaderOptions,
} from '../../../local-process-runtime/windows/functions/loadVerifiedWindowsNativeRuntimeModule';
import type {
  WindowsOwnedPtyNativeBinding,
  WindowsOwnedPtyNativeProcess,
} from '../definitions/windowsOwnedPtyNativeBinding';

export type WindowsOwnedPtyNativeBindingLoaderOptions =
  WindowsNativeRuntimeModuleLoaderOptions;

export interface WindowsOwnedPtyNativeBindingLoader {
  load(): Promise<WindowsOwnedPtyNativeBinding>;
}

function callExactByteAcceptanceMethod(
  owner: object,
  method: (...args: unknown[]) => unknown,
  data: Uint8Array,
): Promise<number> {
  // napi-rs 的 Buffer 参数只接受真正的 Node Buffer。这个转换必须集中在 native
  // binding 边界，不能要求上层每一种输入动作都了解 N-API 的对象类型。
  const nativeBuffer = Buffer.from(data);
  return callWindowsNativeIntegerPromiseMethod(
    owner,
    method,
    'writeInput',
    [nativeBuffer],
  ).then((accepted) => {
    if (accepted !== nativeBuffer.byteLength) {
      throw new WindowsNativeRuntimeLoadError(
        'binding_contract_invalid',
        `Windows local process runtime method writeInput accepted ${accepted} of ${nativeBuffer.byteLength} bytes`,
      );
    }
    return accepted;
  });
}

function wrapNativePtyProcess(input: unknown): WindowsOwnedPtyNativeProcess {
  const processRecord = asWindowsNativeObject(input);
  if (!processRecord) {
    throw new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      'Windows command PTY runtime did not return a native process object',
    );
  }
  const startObservers = readWindowsNativeMethod(processRecord, 'startObservers');
  const resumeAfterObserversReady = readWindowsNativeMethod(
    processRecord,
    'resumeAfterObserversReady',
  );
  const writeInput = readWindowsNativeMethod(processRecord, 'writeInput');
  const resize = readWindowsNativeMethod(processRecord, 'resize');
  const resumeOutput = readWindowsNativeMethod(processRecord, 'resumeOutput');
  const cancelOutput = readWindowsNativeMethod(processRecord, 'cancelOutput');
  const terminateAndWaitTreeEmpty = readWindowsNativeMethod(
    processRecord,
    'terminateAndWaitTreeEmpty',
  );
  const release = readWindowsNativeMethod(processRecord, 'release');

  return Object.freeze({
    startObservers(callback: (payload: unknown) => boolean) {
      callWindowsNativeVoidMethod(processRecord, startObservers, [callback]);
    },
    resumeAfterObserversReady() {
      callWindowsNativeVoidMethod(processRecord, resumeAfterObserversReady, []);
    },
    writeInput(data: Uint8Array) {
      return callExactByteAcceptanceMethod(processRecord, writeInput, data);
    },
    resize(columns: number, rows: number) {
      callWindowsNativeVoidMethod(processRecord, resize, [columns, rows]);
    },
    resumeOutput() {
      callWindowsNativeVoidMethod(processRecord, resumeOutput, []);
    },
    cancelOutput() {
      callWindowsNativeVoidMethod(processRecord, cancelOutput, []);
    },
    terminateAndWaitTreeEmpty() {
      return callWindowsNativePromiseMethod(
        processRecord,
        terminateAndWaitTreeEmpty,
        'terminateAndWaitTreeEmpty',
      );
    },
    release() {
      return callWindowsNativePromiseMethod(processRecord, release, 'release');
    },
  });
}

function wrapNativePtyBinding(input: unknown): WindowsOwnedPtyNativeBinding {
  const bindingRecord = asWindowsNativeObject(input);
  if (!bindingRecord) {
    throw new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      'Windows command PTY runtime module did not export an object',
    );
  }
  const createProcess = readWindowsNativeMethod(
    bindingRecord,
    'createWindowsOwnedPtyProcess',
  );
  return Object.freeze({
    createWindowsOwnedPtyProcess(
      launch: WindowsOwnedPipeNativeLaunchInput,
      columns: number,
      rows: number,
    ) {
      return wrapNativePtyProcess(
        Reflect.apply(createProcess, bindingRecord, [launch, columns, rows]),
      );
    },
  });
}

export function createWindowsOwnedPtyNativeBindingLoader(
  options: WindowsOwnedPtyNativeBindingLoaderOptions,
): WindowsOwnedPtyNativeBindingLoader {
  const moduleLoader = createVerifiedWindowsNativeRuntimeModuleLoader(options);
  let result: Promise<WindowsOwnedPtyNativeBinding> | undefined;
  return Object.freeze({
    load() {
      result ??= moduleLoader.load().then(wrapNativePtyBinding);
      return result;
    },
  });
}
