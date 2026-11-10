import type { BrowserWindow, WebContents } from 'electron';
import { z } from 'zod';
import { CanvasVisualSamplingSchema, assertSoftwareVisualSampling } from './visualSampling';
import { verifyHardwareSceneVisual } from './verifyHardwareSceneVisual';
import { verifySoftwareSceneVisual } from './verifySoftwareSceneVisual';
import { verifySceneStaticVisual } from './verifySceneStaticVisual';

export async function verifySceneVisual(win: BrowserWindow, output: string, evaluate: (contents: WebContents, expression: string) => Promise<unknown>, software = false) {
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const motion = software ? { software: await verifySoftwareSceneVisual(win, output, evaluate) } : await verifyHardwareSceneVisual(win, output, evaluate);
    const shared = await verifySceneStaticVisual(win, output, evaluate, software);
    const began = z.object({ started: z.number(), cameraTransition: z.boolean(), reduced: z.boolean(), sampling: CanvasVisualSamplingSchema })
      .parse(await evaluate(win.webContents, 'window.beginCanvasReducedSceneProbe()'));
    if (software) {
      assertSoftwareVisualSampling(began.sampling);
      if (began.started || began.cameraTransition || began.reduced) throw new Error('software_motion_was_not_immediate_before_preference_change');
    } else if (began.started !== 1 || began.reduced) throw new Error('scene_motion_was_not_running_before_system_preference_change');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced: unknown = await evaluate(win.webContents, 'window.finishCanvasReducedSceneProbe()');
    return { motionProfile: software ? 'software-immediate' : 'hardware-motion', ...motion, ...shared, reduced };
  } finally {
    try { await evaluate(win.webContents, 'window.disposeCanvasSceneProbe()'); }
    finally { await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); win.webContents.debugger.detach(); }
  }
}
