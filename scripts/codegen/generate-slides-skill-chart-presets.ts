import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  renderChartPresetsReference,
  SLIDES_SKILL_ROOT_RELATIVE,
} from './slidesSkillContract.js';

const outputPath = path.join(
  process.cwd(),
  SLIDES_SKILL_ROOT_RELATIVE,
  'references/chart-presets.md',
);
const content = renderChartPresetsReference();
const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf-8') : null;

if (previous === content) {
  process.stdout.write('[generate-slides-skill-chart-presets] unchanged references/chart-presets.md\n');
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content, 'utf-8');
process.stdout.write('[generate-slides-skill-chart-presets] wrote references/chart-presets.md\n');
