const fs = require('node:fs/promises');
const path = require('node:path');

const perfDir = path.resolve(__dirname, '../../../artifacts/performance');
const perfFile = path.join(perfDir, 'e2e-samples.jsonl');

let ensurePerfDirPromise = null;

async function ensurePerfDir() {
  ensurePerfDirPromise ??= fs.mkdir(perfDir, { recursive: true });
  await ensurePerfDirPromise;
}

function roundDuration(durationMs) {
  return Math.round(durationMs * 100) / 100;
}

async function recordBrowserPerfSample(sample) {
  await ensurePerfDir();
  await fs.appendFile(
    perfFile,
    `${JSON.stringify({
      suite: 'e2e',
      timestamp: new Date().toISOString(),
      ...sample,
      duration_ms: roundDuration(sample.duration_ms),
    })}\n`,
    'utf8',
  );
}

async function measureE2E(testInfo, operation, meta, run) {
  const start = performance.now();

  try {
    const result = await run();
    await recordBrowserPerfSample({
      operation,
      duration_ms: performance.now() - start,
      file: testInfo.file,
      project: testInfo.project.name,
      status: 'ok',
      test: testInfo.titlePath.join(' > '),
      meta,
    });
    return result;
  } catch (error) {
    await recordBrowserPerfSample({
      operation,
      duration_ms: performance.now() - start,
      file: testInfo.file,
      project: testInfo.project.name,
      status: 'error',
      test: testInfo.titlePath.join(' > '),
      meta,
    });
    throw error;
  }
}

module.exports = {
  measureE2E,
  recordBrowserPerfSample,
};
