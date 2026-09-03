import type { AiMessage } from '../../../contracts';
import { Logger } from '../../../shared/logger';

export interface ToolSummaryProvider {
  getTool(toolName: string): {
    getExecutionSummary?: (output: string) => string;
  } | undefined;
}

export interface PreprocessorContext {
  debugMode?: boolean;
  model?: string;
  toolSummaryProvider?: ToolSummaryProvider;
}

export interface PreprocessorResult {
  messages: AiMessage[];
  stats: {
    originalCount: number;
    processedCount: number;
    removedCount: number;
    modifiedCount: number;
  };
  appliedStrategies: string[];
}

export interface IPreprocessor {
  readonly name: string;
  readonly description: string;
  readonly priority: number;

  process(
    messages: AiMessage[],
    context: PreprocessorContext
  ): Promise<PreprocessorResult>;

  shouldSkip?(messages: AiMessage[], context: PreprocessorContext): boolean;
}

export abstract class BasePreprocessor implements IPreprocessor {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly priority: number;
  private readonly logger: Logger;

  protected constructor(loggerName?: string) {
    this.logger = new Logger(loggerName ?? this.constructor.name);
  }

  abstract process(
    messages: AiMessage[],
    context: PreprocessorContext
  ): Promise<PreprocessorResult>;

  shouldSkip?(messages: AiMessage[], context: PreprocessorContext): boolean {
    return false;
  }

  protected createResult(
    originalMessages: AiMessage[],
    processedMessages: AiMessage[],
    appliedStrategies: string[],
    modifiedCount: number = 0
  ): PreprocessorResult {
    const removedCount = originalMessages.length - processedMessages.length;

    return {
      messages: processedMessages,
      stats: {
        originalCount: originalMessages.length,
        processedCount: processedMessages.length,
        removedCount,
        modifiedCount,
      },
      appliedStrategies,
    };
  }

  protected debug(message: string, data?: Record<string, unknown>, context?: PreprocessorContext): void {
    if (context?.debugMode) {
      this.logger.debug(`[${this.name}] ${message}`, data);
    }
  }
}
