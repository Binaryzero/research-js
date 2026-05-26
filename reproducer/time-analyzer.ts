/**
 * Wall-clock comparison helper: runs the StaticAnalyzer N times on a given
 * extension directory and reports min/median/max in ms.
 *
 * Usage: tsx reproducer/time-analyzer.ts <ext-dir> [iters]
 */
import { StaticAnalyzer } from '../src/analyzer/static.js';

async function main() {
  const ext = process.argv[2];
  const iters = Number(process.argv[3] || '5');
  if (!ext) {
    console.error('usage: tsx reproducer/time-analyzer.ts <ext-dir> [iters]');
    process.exit(2);
  }

  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const a = new StaticAnalyzer(ext, { verbose: false });
    const start = Date.now();
    await a.analyze();
    samples.push(Date.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`min=${samples[0]}ms median=${median}ms max=${samples[samples.length - 1]}ms iters=${iters} ext=${ext}`);
}

main().catch(err => { console.error(err); process.exit(1); });
