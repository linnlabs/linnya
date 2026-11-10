export type CanvasVisualDiagnostic = 'software-line';

/** 两个正式入口共用这一窄选择，不能把环境变量当任意Renderer表达式。 */
export function readCanvasVisualDiagnostic(requested: string | undefined, software: boolean): CanvasVisualDiagnostic | null {
  if (requested === undefined) return null;
  if (requested !== 'software-line') throw new Error('visual_diagnostic_mode_unknown');
  if (!software) throw new Error('visual_diagnostic_requires_software');
  return requested;
}

export interface CanvasSoftwareLineDiagnosticPorts {
  readonly writeEvidence: (name: string, facts: unknown) => Promise<void>;
  readonly runLine: () => Promise<unknown>;
}

/** 只执行已有line断言；局部诊断成功也不产生完整suite的results.json。 */
export async function runCanvasSoftwareLineDiagnostic(ports: CanvasSoftwareLineDiagnosticPorts): Promise<void> {
  const profile = { diagnostic: 'software-line', fullSuite: false, hardwareQualification: false, requestedRenderingProfile: 'offscreen-swiftshader' };
  await ports.writeEvidence('diagnostic-profile.json', profile);
  try {
    const line = await ports.runLine();
    await ports.writeEvidence('diagnostic-result.json', { ...profile, line });
  } catch (error) {
    await ports.writeEvidence('diagnostic-failure.json', { ...profile, stage: 'existing-line-assertions', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
