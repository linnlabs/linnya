import { runSlidesSkillCheck } from './slidesSkillContract.js';

const result = runSlidesSkillCheck();

if (result.ok) {
  process.stdout.write(
    `[check-slides-skill] OK — ${result.resourceCount} resources, `
      + `${result.estimatedInstructionTokens} estimated instruction tokens, `
      + `${result.validatedExamples.length} examples, `
      + `${result.validatedCliExamples.length} CLI examples.\n`,
  );
  process.exit(0);
}

process.stderr.write(`[check-slides-skill] FAIL — ${result.problems.length} problem(s):\n`);
for (const problem of result.problems) {
  process.stderr.write(`  - [${problem.kind}] ${problem.path}\n      ${problem.message}\n`);
}
process.stderr.write('Hint: run the Slides Skill checks after updating generated references and examples.\n');
process.exit(1);
