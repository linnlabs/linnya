import { Worker } from 'node:worker_threads';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import JSZip from 'jszip';

const PROTOCOL_VERSION = 4;

const workerPath = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  throw new Error('Slides presentation build worker path is required.');
}

const worker = new Worker(workerPath, { name: 'slides-build-worker-smoke' });
let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return `artifact-smoke-${requestSequence}`;
}

function waitForMessage(predicate, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Slides presentation build worker smoke exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    const onMessage = message => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onExit = code => {
      cleanup();
      reject(new Error(`Slides presentation build worker exited early (${code}).`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

async function typecheck(source) {
  const requestId = nextRequestId();
  const responsePromise = waitForMessage(
    message => message?.requestId === requestId,
  );
  worker.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'typecheck',
    requestId,
    source,
  });
  return responsePromise;
}

async function compileCompose(payload) {
  const requestId = nextRequestId();
  const responsePromise = waitForMessage(
    message => message?.requestId === requestId,
  );
  worker.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'compile_compose',
    requestId,
    payload,
  });
  return responsePromise;
}

async function materialize(deckSpec) {
  const requestId = nextRequestId();
  const responsePromise = waitForMessage(
    message => message?.requestId === requestId,
    30_000,
  );
  worker.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'materialize',
    requestId,
    deckSpec,
    svgAssets: [],
    svgFallbacks: [],
  });
  return responsePromise;
}

try {
  const ready = await waitForMessage(message => message?.type === 'ready');
  if (ready.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Slides presentation build worker smoke received the wrong protocol version.');
  }
  const valid = await typecheck('compose({ title: "Artifact smoke", slides: [] });');
  if (valid.type !== 'typecheck_result' || valid.result?.ok !== true) {
    throw new Error('Slides presentation build worker rejected valid deck.js source.');
  }
  const invalid = await typecheck('missingSlidesGlobal();');
  if (
    invalid.type !== 'typecheck_result'
    || invalid.result?.ok !== false
    || !invalid.result.records?.some(record => record.code === 2304)
  ) {
    throw new Error('Slides presentation build worker did not report invalid deck.js source.');
  }
  const compiled = await compileCompose({
    title: 'Artifact layout smoke',
    slides: [{
      _type: 'Slide',
      children: [{
        _type: 'Text',
        content: 'Yoga is loaded from the packaged worker artifact.',
      }],
    }],
  });
  if (
    compiled.type !== 'compile_compose_result'
    || compiled.result?.ok !== true
    || compiled.result.input?.slides?.[0]?.elements?.[0]?.type !== 'text'
    || compiled.result.input.slides[0].elements[0].textWrap !== 'word'
  ) {
    throw new Error('Slides presentation build worker did not compile packaged Yoga layout.');
  }
  const unsupportedFormula = await materialize({
    title: 'Unsupported formula smoke',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [{
          type: 'formula',
          position: { x: 1, y: 1, w: 4, h: 1 },
          source: {
            latex: String.raw`\unknown{x}`,
            display: 'block',
            profileVersion: 1,
            fontSize: 28,
            color: '#173B57',
            align: 'center',
            altText: '不支持的公式',
          },
        }],
      },
    }],
  });
  if (
    unsupportedFormula.type !== 'failure'
    || unsupportedFormula.failure?.kind !== 'formula'
    || unsupportedFormula.failure.code !== 'slides.formula.unsupported_syntax'
  ) {
    throw new Error('Slides presentation build worker did not preserve formula failure facts.');
  }
  const materialized = await materialize({
    title: 'Artifact PPTX smoke',
    layout: '16x9',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [
          {
            type: 'text',
            position: { x: 1, y: 1, w: 8, h: 1 },
            content: [
              { text: 'PptxGenJS, JSZip and inline formula ' },
              {
                formula: {
                  latex: 'E=mc^2',
                  display: 'inline',
                  profileVersion: 1,
                  fontSize: 24,
                  color: '#173B57',
                  align: 'center',
                  altText: '质能方程',
                },
              },
              { text: ' run in the packaged build worker.' },
            ],
          },
          {
            type: 'formula',
            position: { x: 1, y: 2.2, w: 8, h: 1.5 },
            source: {
              latex: String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
              display: 'block',
              profileVersion: 1,
              fontSize: 30,
              color: '#173B57',
              align: 'center',
              altText: '一元二次方程求根公式',
            },
          },
        ],
      },
    }],
  });
  if (materialized.type !== 'materialize_result' || !(materialized.buffer instanceof ArrayBuffer)) {
    throw new Error('Slides presentation build worker did not return a transferable PPTX buffer.');
  }
  const zip = await JSZip.loadAsync(materialized.buffer);
  const slideFile = zip.file('ppt/slides/slide1.xml');
  if (!slideFile) {
    throw new Error('Slides presentation build worker returned an invalid PPTX package.');
  }
  const slideXml = await slideFile.async('text');
  if (
    !slideXml.includes('<a14:m>')
    || !slideXml.includes('<m:oMath>')
    || slideXml.includes('LINNYA_FORMULA_')
  ) {
    throw new Error('Slides presentation build worker did not preserve native formulas.');
  }
  process.stdout.write('Slides presentation build worker artifact smoke passed.\n');
} finally {
  await worker.terminate();
}
