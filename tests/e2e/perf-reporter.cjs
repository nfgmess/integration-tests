const fs = require('node:fs/promises');
const path = require('node:path');

const perfDir = path.resolve(__dirname, '../../artifacts/performance');
const perfFile = path.join(perfDir, 'e2e-samples.jsonl');

async function recordSample(sample) {
  await fs.mkdir(perfDir, { recursive: true });
  await fs.appendFile(
    perfFile,
    `${JSON.stringify({
      suite: 'e2e',
      timestamp: new Date().toISOString(),
      ...sample,
      duration_ms: Math.round(sample.duration_ms * 100) / 100,
    })}\n`,
    'utf8',
  );
}

class PerfReporter {
  async onTestEnd(test, result) {
    await recordSample({
      operation: 'test.total',
      duration_ms: result.duration,
      file: test.location.file,
      project: result.projectName,
      status: result.status === 'passed' ? 'ok' : 'error',
      test: test.titlePath().join(' > '),
      meta: {
        expected_status: test.expectedStatus,
        retry: result.retry,
      },
    });
  }
}

module.exports = PerfReporter;
