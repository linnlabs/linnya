import { WindowsNativeRuntimeLoadError } from '../definitions/windowsNativeRuntimeManifest';

export type WindowsNativeUnknownMethod = (...args: unknown[]) => unknown;

export function asWindowsNativeObject(value: unknown): object | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

export function readWindowsNativeMethod(
  record: object,
  name: string,
): WindowsNativeUnknownMethod {
  const candidate = Reflect.get(record, name);
  if (typeof candidate !== 'function') {
    throw new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      `Windows local process runtime binding is missing method ${name}`,
    );
  }
  return candidate;
}

export function callWindowsNativeVoidMethod(
  owner: object,
  method: WindowsNativeUnknownMethod,
  args: unknown[],
): void {
  Reflect.apply(method, owner, args);
}

export function callWindowsNativePromiseMethod(
  owner: object,
  method: WindowsNativeUnknownMethod,
  name: string,
): Promise<void> {
  const result = Reflect.apply(method, owner, []);
  const promiseRecord = asWindowsNativeObject(result);
  if (!promiseRecord || typeof Reflect.get(promiseRecord, 'then') !== 'function') {
    return Promise.reject(new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      `Windows local process runtime method ${name} did not return a Promise`,
    ));
  }
  return Promise.resolve(result).then(() => undefined);
}

export function callWindowsNativeIntegerPromiseMethod(
  owner: object,
  method: WindowsNativeUnknownMethod,
  name: string,
  args: unknown[],
): Promise<number> {
  const result = Reflect.apply(method, owner, args);
  const promiseRecord = asWindowsNativeObject(result);
  if (!promiseRecord || typeof Reflect.get(promiseRecord, 'then') !== 'function') {
    return Promise.reject(new WindowsNativeRuntimeLoadError(
      'binding_contract_invalid',
      `Windows local process runtime method ${name} did not return a Promise`,
    ));
  }
  return Promise.resolve(result).then((value) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new WindowsNativeRuntimeLoadError(
        'binding_contract_invalid',
        `Windows local process runtime method ${name} did not resolve to a non-negative integer`,
      );
    }
    return value;
  });
}
