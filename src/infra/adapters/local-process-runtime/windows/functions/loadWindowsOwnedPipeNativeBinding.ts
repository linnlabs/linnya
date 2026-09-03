import type {
  WindowsOwnedPipeNativeBinding,
  WindowsOwnedPipeNativeLaunchInput,
  WindowsOwnedPipeNativeOutputChannel,
  WindowsOwnedPipeNativeProcess,
} from '../definitions/windowsOwnedPipeNativeBinding';
import { WindowsNativeRuntimeLoadError } from '../definitions/windowsNativeRuntimeManifest';
import {
  asWindowsNativeObject,
  callWindowsNativePromiseMethod,
  callWindowsNativeVoidMethod,
  readWindowsNativeMethod,
} from './windowsNativeBindingContract';
import {
  createVerifiedWindowsNativeRuntimeModuleLoader,
  type WindowsNativeRuntimeModuleLoaderOptions,
} from './loadVerifiedWindowsNativeRuntimeModule';

export type WindowsOwnedPipeNativeBindingLoaderOptions =
  WindowsNativeRuntimeModuleLoaderOptions;

export interface WindowsOwnedPipeNativeBindingLoader {
  load(): Promise<WindowsOwnedPipeNativeBinding>;
}

function wrapNativeProcess(input: unknown): WindowsOwnedPipeNativeProcess {
  const processRecord = asWindowsNativeObject(input);
  if (!processRecord) {
    throw new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      'Windows local process runtime did not return a native pipe process object',
    );
  }
  const startObservers = readWindowsNativeMethod(processRecord, 'startObservers');
  const resumeAfterObserversReady = readWindowsNativeMethod(
    processRecord,
    'resumeAfterObserversReady',
  );
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
    resumeOutput(channel: WindowsOwnedPipeNativeOutputChannel) {
      callWindowsNativeVoidMethod(processRecord, resumeOutput, [channel]);
    },
    cancelOutput(channel: WindowsOwnedPipeNativeOutputChannel) {
      callWindowsNativeVoidMethod(processRecord, cancelOutput, [channel]);
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

function wrapNativeBinding(input: unknown): WindowsOwnedPipeNativeBinding {
  const bindingRecord = asWindowsNativeObject(input);
  if (!bindingRecord) {
    throw new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      'Windows local process runtime module did not export an object',
    );
  }
  const createProcess = readWindowsNativeMethod(
    bindingRecord,
    'createWindowsOwnedPipeProcess',
  );
  return Object.freeze({
    createWindowsOwnedPipeProcess(launch: WindowsOwnedPipeNativeLaunchInput) {
      return wrapNativeProcess(Reflect.apply(createProcess, bindingRecord, [launch]));
    },
  });
}

export function createWindowsOwnedPipeNativeBindingLoader(
  options: WindowsOwnedPipeNativeBindingLoaderOptions,
): WindowsOwnedPipeNativeBindingLoader {
  const moduleLoader = createVerifiedWindowsNativeRuntimeModuleLoader(options);
  let result: Promise<WindowsOwnedPipeNativeBinding> | undefined;
  return Object.freeze({
    load() {
      result ??= moduleLoader.load().then(wrapNativeBinding);
      return result;
    },
  });
}
