export declare const TRANSIENT_NETWORK_RETRY_DELAYS_MS: readonly number[];

export interface RetryTransientNetworkInput<T> {
  readonly label: string;
  readonly attempt: () => T | Promise<T>;
  readonly describeTransient: (error: unknown) => string | undefined;
  readonly delaysMs?: readonly number[];
  readonly wait?: (ms: number) => Promise<unknown>;
}

export declare function retryTransientNetwork<T>(input: RetryTransientNetworkInput<T>): Promise<T>;

export interface RegistryCommandInput {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly delaysMs?: readonly number[];
  readonly wait?: (ms: number) => Promise<unknown>;
}

export declare function runRegistryCommand(input: RegistryCommandInput): Promise<void>;
