import { PromptKeys } from '@app/schemas';
import { RESEARCH_FEEDBACK_METHOD_V1 } from '../definitions/researchFeedbackMethod';
import type {
  PreparedResearchStageRequest,
  ResearchMethodResource,
  ResearchStageRequestInput,
  ResearchStageRequestKind,
} from '../definitions/researchStageRequest';

const STAGE_CONTRACTS = {
  investigation: {
    promptKey: PromptKeys.RESEARCH_AUTHOR_V1,
    task: 'Investigate the question and submit a compact research record with source locators, acquisition limits, current explanations, important premises, counterevidence and unresolved observations. Do not draft the final article yet. For an update, first read the prior article and its evidence. Seek observations that could change the explanation, including relevant actors, interests, anomalies and indirect mechanisms.',
    resources: ['references/modeling.md'],
  },
  investigation_review: {
    promptKey: PromptKeys.RESEARCH_INVESTIGATION_REVIEW_V1,
    task: 'Independently review the investigation BEFORE drafting. Work from the question, research record and original materials; a finished article is not required. Identify omitted actors or interests, anomalies and plausible alternative mechanisms. Explain what observation could distinguish explanations, then investigate useful leads within scope. Submit concrete findings, new source locations and remaining gaps, allowing that the available evidence may not distinguish explanations. Do not write the article.',
    resources: ['references/modeling.md'],
  },
  draft: {
    promptKey: PromptKeys.RESEARCH_AUTHOR_V1,
    task: 'Read the research record and independent investigation review. Check important suggestions against the materials, perform bounded follow-up where permitted, and write one coherent article for the specified reader. Develop useful mechanisms and competing explanations in an understandable order. Submit only the article Markdown as the content; do not append a process report or review disposition ledger.',
    resources: ['references/modeling.md', 'references/article-craft.md'],
  },
  argument_review: {
    promptKey: PromptKeys.RESEARCH_ARGUMENT_REVIEW_V1,
    task: "Independently review the exact supplied article version. Trace consequential claims through evidence, causal bridges, necessary versus sufficient conditions, competing explanations and counterfactuals. Check whether the title, opening and conclusion widen the body, and whether the intended reader can follow definitions and mechanisms. Do not read the parallel reviewer's findings or rewrite the article. Submit a review with passages, evidence, consequences, suggestions and unverified scope.",
    resources: ['references/modeling.md', 'references/article-craft.md'],
  },
  source_review: {
    promptKey: PromptKeys.RESEARCH_SOURCE_REVIEW_V1,
    task: "Independently check the exact supplied article version. Derive key quantities and comparisons from its prose, including the title, opening and conclusion. Check source versions, population or sample, units, periods, denominator, footnotes and citations. Actually execute consequential calculations. Inspect actual tables or page images for chart-dependent claims; extracted text alone is not visual inspection. Do not read the parallel reviewer's findings or rewrite the article. Submit source locations, computations, consequences, suggestions and material you could not verify.",
    resources: ['references/modeling.md'],
  },
  revision: {
    promptKey: PromptKeys.RESEARCH_AUTHOR_V1,
    task: 'Read the supplied article and both original independent reviews. Make one evidence-based main revision within the frozen question and material scope. Verify review claims, including findings you reject or only partially address, rather than accepting votes. Preserve useful explanations, counterevidence and conditions. Submit only the revised article Markdown as the content; do not append a process report or review disposition ledger. If an unresolved issue affects the conclusion, express the corresponding limitation in the article.',
    resources: ['references/modeling.md', 'references/article-craft.md'],
  },
} satisfies Record<
  ResearchStageRequestKind,
  {
    promptKey: string;
    task: string;
    resources: readonly ResearchMethodResource[];
  }
>;

function linesOrNone(lines: readonly string[]): string {
  return lines.length === 0 ? '- None supplied.' : lines.map(line => `- ${line}`).join('\n');
}

/** 只组织当前阶段的完整请求；不读取状态、不派发阶段、不把模型自述转成通过事实。 */
export function buildResearchStageRequest(
  input: ResearchStageRequestInput
): PreparedResearchStageRequest {
  const contract = STAGE_CONTRACTS[input.stage];
  const requiredResources: ResearchMethodResource[] = [...contract.resources];
  if (input.businessAnalysisNeeded) requiredResources.push('references/business-analysis.md');
  const authorReceivesFeedback = input.stage === 'draft' || input.stage === 'revision';
  const reviewer =
    input.stage === 'investigation_review' ||
    input.stage === 'argument_review' ||
    input.stage === 'source_review';
  const retrieval = input.allowRetrieval
    ? 'Retrieval is allowed only within the material boundary below. Optional web_search(deep_search=true) can investigate a concrete gap; shallow search is sufficient when it answers the gap. Do not use a search quota as a target.'
    : 'No external retrieval is allowed: do not call Web or Knowledge search/read, use network commands, or introduce outside facts from memory. Read only the supplied documents and their supplied content; report missing originals or evidence instead of filling them in.';
  const method = authorReceivesFeedback
    ? RESEARCH_FEEDBACK_METHOD_V1.author
    : reviewer
      ? RESEARCH_FEEDBACK_METHOD_V1.reviewer
      : '';

  const query = [
    `# Research stage: ${input.stage}`,
    `Question: ${input.question}`,
    `Reader: ${input.reader}`,
    `Task type: ${input.taskType}`,
    `Material boundary: ${input.materialBoundary}`,
    ...(input.timeRange ? [`Time range: ${input.timeRange}`] : []),
    ...(input.deliverableRequirements
      ? [`Deliverable requirements: ${input.deliverableRequirements}`]
      : []),
    '',
    '## Material and access constraints',
    retrieval,
    'Fixed documents:',
    linesOrNone(input.fixedDocumentLocators),
    'Previous artifacts (read these formal locators; version labels are navigation supplied by the Host):',
    linesOrNone(
      input.previousArtifacts.map(
        item => `${item.locator} | version: ${item.version} | ${item.purpose}`
      )
    ),
    'All previous artifacts explicitly listed here are permitted earlier-stage context, including a completed investigation review. A parallel reviewer means the other reviewer examining this same draft now; their report is not listed here. Do not mistake permitted earlier-stage context for a forbidden parallel review.',
    'Use source-reading results from this run for canonical citations. Bare short refs from another run are not transferable; reread the formal document or original source to obtain the current binding.',
    '',
    '## Required method access',
    'Activate the full deep-research Skill 1.4 before work, then read these applicable resources with skill.read_resource; catalog exposure and requiredSkills do not load them:',
    ...requiredResources.map(resource => `- ${resource}`),
    'Use modeling, sensitivity, scenarios or Bayesian reasoning only when the question benefits from them. Define objects, driver relations, constraint sources and unknown parameters; execute relevant calculations. Unsupported priors or likelihoods do not justify precise probabilities. A consistent conditional counterexample is not evidence that it occurred. Do not force three scenarios or numeric modeling into every task.',
    '',
    '## This stage',
    input.boundedAssignment && input.stage === 'investigation'
      ? 'Investigate only the bounded assignment below. The overall question is context, not a request to repeat the entire investigation. Return a compact evidence record with useful observations, exact source locators, acquisition limits and unresolved points. Do not draft an article or complete the parent’s investigation.'
      : contract.task,
    ...(input.boundedAssignment
      ? ['Lead Agent assignment (within the frozen scope):', input.boundedAssignment]
      : []),
    'Concrete unresolved questions:',
    linesOrNone(input.unresolvedQuestions),
    'Specific feedback to investigate (also read the full supplied original reviews):',
    linesOrNone(input.feedback),
    ...(method ? ['', `## Feedback method ${RESEARCH_FEEDBACK_METHOD_V1.version}`, method] : []),
    '',
    '## Single stage deliverable',
    `Planned Workspace locator: ${input.output.locator}`,
    `Purpose: ${input.output.purpose}`,
    "Finish by calling submit_research_document with exactly one complete Markdown deliverable in content, without a surrounding code fence. The Host saves it create-only at the planned new Workspace path and validates the saved projection and citation bindings. This fulfills the Skill's save-and-readback requirement during the tool call; a free-text final answer is not a substitute. Correct a reported format or citation error against the actual source context and resubmit in this same stage, without claiming success or removing necessary evidence to avoid validation. Input-version changes or cancellation are stopping conditions, not instructions to rewrite the task.",
    'The lead Agent owns stage selection; the Host binds this particular assignment and its document versions. Do not delegate extra reviewers or use application internals, databases or command-line control endpoints to launch runs or modify project documents. Shell/process are for permitted calculations and source processing, not a substitute Workspace write path. Review findings and successful tool calls are not correctness certificates.',
  ].join('\n');

  return {
    promptKey: contract.promptKey,
    query,
    methodVersion: RESEARCH_FEEDBACK_METHOD_V1.version,
    requiredResources,
  };
}
