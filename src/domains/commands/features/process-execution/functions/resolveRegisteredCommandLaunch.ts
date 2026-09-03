import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  CommandExecutionError,
  type CommandLaunchSpec,
  type RegisteredCommandDescriptor,
  type RegisteredCommandExecutionRequest,
} from '../../../definitions/commandExecution';
import type { CommandDescriptorRegistryPort } from '../../../ports/commandDescriptorRegistryPort';

function fail(
  code: CommandExecutionError['code'],
  message: string,
): never {
  throw new CommandExecutionError(code, message);
}

function assertNonBlank(value: string, field: string): void {
  if (!value.trim()) {
    fail('command.execution.invalid_request', `${field} must not be empty`);
  }
}

function assertProcessString(value: string, field: string): void {
  if (value.includes('\0')) {
    fail('command.execution.invalid_request', `${field} must not contain NUL`);
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveDirectory(pathValue: string): Promise<string> {
  if (!path.isAbsolute(pathValue)) {
    fail('command.execution.invalid_request', 'Command cwd must be absolute');
  }
  try {
    const resolved = await fsp.realpath(pathValue);
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory()) {
      fail('command.execution.cwd_out_of_scope', 'Command cwd must be a directory');
    }
    return resolved;
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      throw error;
    }
    fail('command.execution.cwd_out_of_scope', 'Command cwd is unavailable');
  }
}

async function resolveExecutable(descriptor: RegisteredCommandDescriptor): Promise<string> {
  if (!path.isAbsolute(descriptor.executablePath)) {
    fail('command.execution.executable_unavailable', 'Registered executable path must be absolute');
  }
  try {
    const resolved = await fsp.realpath(descriptor.executablePath);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      fail('command.execution.executable_unavailable', 'Registered executable must be a file');
    }
    return resolved;
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      throw error;
    }
    fail('command.execution.executable_unavailable', 'Registered executable is unavailable');
  }
}

function resolveTimeout(
  request: RegisteredCommandExecutionRequest,
  descriptor: RegisteredCommandDescriptor,
): number {
  const timeoutMs = request.timeoutMs ?? descriptor.defaultTimeoutMs;
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > descriptor.maxTimeoutMs
  ) {
    fail('command.execution.invalid_request', 'Command timeout is outside the registered limit');
  }
  return timeoutMs;
}

function assertDescriptorLimits(descriptor: RegisteredCommandDescriptor): void {
  const limits = [
    descriptor.defaultTimeoutMs,
    descriptor.maxTimeoutMs,
    descriptor.maxStdoutBytes,
    descriptor.maxStderrBytes,
  ];
  if (limits.some(value => !Number.isInteger(value) || value <= 0)) {
    fail('command.execution.invalid_request', 'Registered command limits must be positive integers');
  }
  if (descriptor.defaultTimeoutMs > descriptor.maxTimeoutMs) {
    fail('command.execution.invalid_request', 'Registered default timeout exceeds the maximum');
  }
}

function buildEnvironment(
  request: RegisteredCommandExecutionRequest,
  descriptor: RegisteredCommandDescriptor,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const key of descriptor.inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  Object.assign(environment, descriptor.fixedEnvironment ?? {});

  const allowedOverrides = new Set(descriptor.allowedEnvironmentOverrides);
  for (const [key, value] of Object.entries(request.environment ?? {})) {
    if (!allowedOverrides.has(key)) {
      fail('command.execution.environment_not_allowed', `Environment override is not allowed: ${key}`);
    }
    if (!key || key.includes('=') || key.includes('\0') || value.includes('\0')) {
      fail('command.execution.invalid_request', 'Command environment contains an invalid entry');
    }
    environment[key] = value;
  }
  return Object.freeze(environment);
}

export async function resolveRegisteredCommandLaunch(input: {
  readonly request: RegisteredCommandExecutionRequest;
  readonly registry: CommandDescriptorRegistryPort;
}): Promise<CommandLaunchSpec> {
  assertNonBlank(input.request.commandId, 'commandId');
  const descriptor = input.registry.get(input.request.commandId);
  if (!descriptor) {
    fail('command.execution.command_unavailable', 'Command is not registered');
  }
  assertDescriptorLimits(descriptor);
  if (descriptor.id !== input.request.commandId) {
    fail('command.execution.command_unavailable', 'Command registry returned a mismatched descriptor');
  }
  if (descriptor.allowedCwdRoots.length === 0) {
    fail('command.execution.cwd_out_of_scope', 'Registered command has no allowed cwd root');
  }

  const [executablePath, cwd, ...allowedRoots] = await Promise.all([
    resolveExecutable(descriptor),
    resolveDirectory(input.request.cwd),
    ...descriptor.allowedCwdRoots.map(resolveDirectory),
  ]);
  if (!allowedRoots.some(root => isWithinRoot(cwd, root))) {
    fail('command.execution.cwd_out_of_scope', 'Command cwd is outside the registered roots');
  }

  const argv = [...(descriptor.argvPrefix ?? []), ...input.request.argv].map((value, index) => {
    assertProcessString(value, `argv[${index}]`);
    return value;
  });
  return Object.freeze({
    commandId: descriptor.id,
    executablePath,
    argv: Object.freeze(argv),
    cwd,
    environment: buildEnvironment(input.request, descriptor),
    timeoutMs: resolveTimeout(input.request, descriptor),
    maxStdoutBytes: descriptor.maxStdoutBytes,
    maxStderrBytes: descriptor.maxStderrBytes,
  });
}
