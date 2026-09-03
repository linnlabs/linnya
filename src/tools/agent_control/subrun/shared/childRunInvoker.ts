import type { RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isRegisteredChildRunInvokerPort(value: unknown): value is RegisteredChildRunInvokerPort {
  if (!isObjectRecord(value)) return false;
  return typeof value['invoke'] === 'function';
}

export function readToolContextChildRunInvoker(context: ToolExecutionContext): RegisteredChildRunInvokerPort | undefined {
  const candidate = context.registeredChildRunInvoker;
  return isRegisteredChildRunInvokerPort(candidate) ? candidate : undefined;
}

export function resolveRegisteredChildRunInvoker(context: ToolExecutionContext): RegisteredChildRunInvokerPort {
  const invoker = readToolContextChildRunInvoker(context);
  if (!invoker) {
    throw new Error('[childRunInvoker] registeredChildRunInvoker is required before child-run admission');
  }
  return invoker;
}
