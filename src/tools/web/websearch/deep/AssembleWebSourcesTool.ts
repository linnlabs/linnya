import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../../types';
import {
  AssembleWebSourcesArgsSchema,
  AssembleWebSourcesToolOutputSchema,
  WebSearchArgsSchema,
} from '@app/schemas';
import {
  requireWebSearchAcquisitions,
  requireWebSearchSnapshotReader,
} from './ports/webSearchSnapshotReader';
import { requireWebEvidenceWriter } from '../../shared/orchestration/webEvidenceWriterContext';
import { assembleWebMaterials } from './functions/assembleWebMaterials';

export class AssembleWebSourcesTool extends BaseTool {
  readonly name = 'assemble_web_sources';
  readonly description =
    'Finish this web research child by selecting acquired refs with brief relevance notes. For each read source, give up to two anchors: short phrases copied exactly from the text you read (for example the sentence fragment with the key number). The tool cuts about 600 characters of original text around each anchor from your reads and reports anchors it cannot find; without anchors the parent only sees the start of the page. Do not repeat excerpts or supply URLs. Include source limitations, conflicting clues and unresolved gaps. This ends the child; no final prose answer is needed.';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      selected: {
        type: 'array',
        description: 'Selected sources.',
        maxItems: 50,
        items: {
          type: 'object',
          description: 'One source.',
          additionalProperties: false,
          properties: {
            ref: {
              type: 'string',
              minLength: 6,
              maxLength: 6,
              description: 'Canonical bare six-character citation ref from this run.',
            },
            purpose: {
              type: 'string',
              minLength: 1,
              maxLength: 10000,
              description:
                'One short sentence on relevance (aim under 150 characters). Do not summarize the whole source. Model assessment, not verified fact.',
            },
            anchors: {
              type: 'array',
              maxItems: 2,
              description:
                'Up to two short phrases (5-20 words, max 200 characters) copied exactly from the text you read, at the passages that support the purpose. Each locates one excerpt for the parent.',
              items: { type: 'string', description: 'Exact phrase from the source text.', minLength: 1, maxLength: 200 },
            },
          },
          required: ['ref', 'purpose'],
        },
      },
      summary: {
        type: 'string',
        maxLength: 10000,
        description:
          'Two or three short sentences (aim under 600 characters), not a report or a verified answer.',
      },
      gaps: {
        type: 'array',
        description: 'Unresolved gaps.',
        maxItems: 8,
        items: {
          type: 'string',
          description:
            'One short sentence (aim under 250 characters); do not repeat source passages.',
          minLength: 1,
          maxLength: 10000,
        },
      },
      conflicts: {
        type: 'array',
        description: 'Conflicting clues.',
        maxItems: 8,
        items: {
          type: 'string',
          description:
            'One short sentence (aim under 250 characters); do not repeat source passages.',
          minLength: 1,
          maxLength: 10000,
        },
      },
    },
    required: ['selected', 'summary', 'gaps', 'conflicts'],
  };
  readonly argumentValidationErrorCode = 'ASSEMBLE_WEB_SOURCES_ARGUMENTS_INVALID';

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = AssembleWebSourcesArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    const details = parsed.error.issues
      .map(
        issue => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`
      )
      .join('; ');
    return {
      success: false,
      error: `[${this.argumentValidationErrorCode}] assemble_web_sources 参数不符合合同: ${details}\n只提交 selected.ref、简短 purpose、可选 anchors（最多两条、每条 200 字以内的原文短语）、summary、gaps、conflicts；不要提交 URL 或大段原文。`,
    };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const task = WebSearchArgsSchema.parse(JSON.parse(context.userQuery ?? ''));
    const data = await assembleWebMaterials({
      selection: AssembleWebSourcesArgsSchema.parse(args),
      acquisitions: requireWebSearchAcquisitions(context).list(),
      reader: requireWebSearchSnapshotReader(context),
      topK: task.top_k,
      writer: requireWebEvidenceWriter(context),
      query: task.query,
    });
    return JSON.stringify(
      AssembleWebSourcesToolOutputSchema.parse({
        data,
        observation: `Selected ${data.sources.length} sources. Gaps and source limitations are not verification.`,
        control: { terminateRun: true, reason: 'assemble_web_sources: completed' },
      })
    );
  }
}
