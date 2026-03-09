import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const perfDir = path.join(rootDir, 'artifacts', 'performance');
const rustSamplesPath = path.join(perfDir, 'rust-samples.jsonl');
const e2eSamplesPath = path.join(perfDir, 'e2e-samples.jsonl');
const summaryMarkdownPath = path.join(perfDir, 'summary.md');
const summaryJsonPath = path.join(perfDir, 'summary.json');

function percentile(sorted, ratio) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function readJsonLines(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function aggregate(samples) {
  const buckets = new Map();

  for (const sample of samples) {
    const key = `${sample.suite}:${sample.operation}`;
    const bucket = buckets.get(key) ?? {
      suite: sample.suite,
      operation: sample.operation,
      count: 0,
      durations: [],
      errors: 0,
    };
    bucket.count += 1;
    bucket.durations.push(sample.duration_ms);
    if (sample.status !== 'ok') {
      bucket.errors += 1;
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      const total = sorted.reduce((sum, duration) => sum + duration, 0);
      return {
        suite: bucket.suite,
        operation: bucket.operation,
        count: bucket.count,
        errors: bucket.errors,
        avg_ms: round(total / sorted.length),
        p95_ms: round(percentile(sorted, 0.95)),
        max_ms: round(sorted[sorted.length - 1]),
      };
    })
    .sort((a, b) => b.p95_ms - a.p95_ms || b.avg_ms - a.avg_ms);
}

function topSlowSamples(samples, limit = 10) {
  return [...samples]
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, limit)
    .map((sample) => ({
      suite: sample.suite,
      operation: sample.operation,
      duration_ms: round(sample.duration_ms),
      status: sample.status,
      test: sample.test ?? sample.caller ?? '',
    }));
}

function toMarkdown(aggregates, slowSamples) {
  const lines = [
    '# Integration Performance Summary',
    '',
    '## Slowest Operations',
    '',
    '| suite | operation | samples | errors | avg ms | p95 ms | max ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...aggregates.slice(0, 20).map((row) => `| ${row.suite} | ${row.operation} | ${row.count} | ${row.errors} | ${row.avg_ms} | ${row.p95_ms} | ${row.max_ms} |`),
    '',
    '## Slowest Samples',
    '',
    '| suite | operation | duration ms | status | context |',
    '| --- | --- | ---: | --- | --- |',
    ...slowSamples.map((sample) => `| ${sample.suite} | ${sample.operation} | ${sample.duration_ms} | ${sample.status} | ${String(sample.test).replaceAll('|', '\\|')} |`),
    '',
  ];

  return lines.join('\n');
}

const samples = [
  ...(await readJsonLines(rustSamplesPath)),
  ...(await readJsonLines(e2eSamplesPath)),
];

await mkdir(perfDir, { recursive: true });

const aggregates = aggregate(samples);
const slowSamples = topSlowSamples(samples);
const markdown = toMarkdown(aggregates, slowSamples);

await writeFile(summaryMarkdownPath, markdown, 'utf8');
await writeFile(
  summaryJsonPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      samples: samples.length,
      operations: aggregates,
      slow_samples: slowSamples,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(markdown);
