import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prepareCanvasCliObservation } from './prepare';

const request = z.object({ productionPluginDirectory: z.string().min(1), outputDirectory: z.string().min(1), evidenceDirectory: z.string().min(1),
  productionSourceRevision: z.string().regex(/^[a-f0-9]{40}$/), observationSourceRevision: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error('usage: cli-observation/run.ts REQUEST.json');
const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
console.log(JSON.stringify(await prepareCanvasCliObservation(request.parse(value)), null, 2));
