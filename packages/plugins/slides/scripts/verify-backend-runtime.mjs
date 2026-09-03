import Module from 'node:module';
import path from 'node:path';
import process from 'node:process';

const entryPath = path.resolve(process.argv[2] ?? 'dist/backend/index.cjs');
const backendDir = path.dirname(entryPath);
const originalLoad = Module._load;
const noop = createNoopProxy();
let typescriptLoadCount = 0;

Module._load = function loadSlidesBackendDependency(request, parent, isMain) {
  if (request === './node_modules/typescript') {
    const resolved = Module._resolveFilename(request, parent, isMain);
    const expectedRoot = path.join(backendDir, 'node_modules', 'typescript');
    if (!isInside(expectedRoot, resolved)) {
      throw new Error(`Slides backend resolved TypeScript outside its artifact: ${resolved}`);
    }
    typescriptLoadCount += 1;
  }
  if (request === '@plugin/backend/toolRuntime') {
    return { BaseTool: class BaseTool {} };
  }
  if (request.startsWith('@plugin/') || request.startsWith('@app/')) {
    return noop;
  }
  return originalLoad.apply(this, arguments);
};

try {
  const backendModule = Module.createRequire(entryPath)(entryPath);
  if (typescriptLoadCount !== 0) {
    throw new Error('Slides backend loaded TypeScript while registering its contribution.');
  }

  const profile = backendModule.backendPlugin?.sandboxProfiles?.[0];
  if (
    !profile ||
    typeof profile.buildPolicy !== 'function' ||
    typeof profile.prepareExecution !== 'function'
  ) {
    throw new Error('Slides backend artifact did not expose the ppt_compose sandbox profile.');
  }
  const request = {
    language: 'javascript',
    source: [
      'const slide = createSlide();',
      'slide.add(createText("artifact smoke"));',
      'compose({ title: "artifact smoke", slides: [slide] });',
    ].join('\n'),
  };
  const policy = profile.buildPolicy(request);
  const prepared = profile.prepareExecution(request, policy, 'slides-backend-artifact-smoke');
  if (!prepared?.runnerRequest?.source?.includes('__withLoc(')) {
    throw new Error(
      'Slides backend artifact did not run TypeScript-backed source instrumentation.'
    );
  }
  if (typescriptLoadCount !== 1) {
    throw new Error(
      `Slides backend expected one lazy TypeScript load, received ${typescriptLoadCount}.`
    );
  }

  process.stdout.write('[slides-backend] lazy runtime smoke passed\n');
} finally {
  Module._load = originalLoad;
}

function createNoopProxy() {
  let proxy;
  const target = function noopTarget() {};
  proxy = new Proxy(target, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === '__esModule') return true;
      if (property === Symbol.toPrimitive) return () => '';
      return proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
