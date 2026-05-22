/**
 * VSIX coverage measurement script.
 *
 * For one or more extracted extension directories, classifies every file and
 * reports, per class, how many were examined by the LLM input set
 * (`readFindingSourceFiles`, exposed through `buildSourceFiles`). The output
 * is the empirical answer to "what fraction of files of each type currently
 * enters the LLM?"
 *
 * Usage:
 *   npx tsx reproducer/measure-vsix-coverage.ts <path-to-extracted-extension>...
 *   # or pass a directory containing many extracted extensions:
 *   npx tsx reproducer/measure-vsix-coverage.ts /path/to/vsix-root --recursive
 *
 * The script does NOT download VSIX files itself. Use the existing CLI
 * download helper or VS Code's installed-extensions directory:
 *   ~/.vscode/extensions/<publisher>.<name>-<version>/
 *
 * To run against ≥20 real extensions, list 20 such directories or pass a
 * parent dir with --recursive. The report enumerates per-class totals and a
 * "examined" percentage that surfaces the structural gap (or the closed gap,
 * after the fix lands).
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, relative, resolve } from 'path';
import { StaticAnalyzer } from '../src/analyzer/static.js';
import { buildSourceFiles } from '../src/analyzer/llm.js';

type FileClass =
  | 'js_ts'
  | 'manifest'
  | 'shell_script'
  | 'native_module'
  | 'wasm'
  | 'webview'
  | 'config'
  | 'doc'
  | 'asset'
  | 'lockfile'
  | 'other';

interface PerClassCount {
  total: number;
  examined: number;
}

interface ExtensionReport {
  path: string;
  totalFiles: number;
  llmInputFiles: number;
  byClass: Record<FileClass, PerClassCount>;
}

const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd']);
const WEBVIEW_EXTS = new Set(['.html', '.htm', '.svg']);
const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.xml', '.toml']);
const DOC_EXTS = new Set(['.md', '.txt', '.rst']);
const ASSET_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.css', '.scss']);
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']);

function classify(relPath: string): FileClass {
  const base = basename(relPath).toLowerCase();
  const ext = extname(relPath).toLowerCase();
  if (LOCKFILES.has(base)) return 'lockfile';
  if (base === 'package.json' || base === 'extension.vsixmanifest' || base === '.vsixmanifest') return 'manifest';
  if (JS_EXTS.has(ext)) return 'js_ts';
  if (SHELL_EXTS.has(ext)) return 'shell_script';
  if (ext === '.node') return 'native_module';
  if (ext === '.wasm') return 'wasm';
  if (WEBVIEW_EXTS.has(ext)) return 'webview';
  if (CONFIG_EXTS.has(ext)) return 'config';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (ASSET_EXTS.has(ext)) return 'asset';
  return 'other';
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function isExtensionDir(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

function resolveTargets(args: string[]): string[] {
  const targets: string[] = [];
  let recursive = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === '--recursive' || a === '-r') {
      recursive = true;
    } else {
      paths.push(resolve(a));
    }
  }
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`[warn] path does not exist: ${p}`);
      continue;
    }
    if (recursive && statSync(p).isDirectory() && !isExtensionDir(p)) {
      for (const sub of readdirSync(p)) {
        const full = join(p, sub);
        if (statSync(full).isDirectory() && isExtensionDir(full)) targets.push(full);
      }
    } else {
      targets.push(p);
    }
  }
  return targets;
}

async function measure(extDir: string): Promise<ExtensionReport> {
  const all = walk(extDir).map(p => relative(extDir, p));
  const analyzer = new StaticAnalyzer(extDir, { verbose: false });
  const result = await analyzer.analyze();

  // The LLM input set is whatever buildSourceFiles emits for the actual
  // findings the analyzer produced. We parse out the `--- path ---` headers
  // to learn which files made it in.
  const llmInput = buildSourceFiles(result.findings, extDir);
  const includedPaths = new Set<string>();
  for (const m of llmInput.matchAll(/^---\s+(.+?)\s+---$/gm)) {
    includedPaths.add(m[1]);
  }

  const byClass: Record<FileClass, PerClassCount> = {
    js_ts: { total: 0, examined: 0 },
    manifest: { total: 0, examined: 0 },
    shell_script: { total: 0, examined: 0 },
    native_module: { total: 0, examined: 0 },
    wasm: { total: 0, examined: 0 },
    webview: { total: 0, examined: 0 },
    config: { total: 0, examined: 0 },
    doc: { total: 0, examined: 0 },
    asset: { total: 0, examined: 0 },
    lockfile: { total: 0, examined: 0 },
    other: { total: 0, examined: 0 },
  };

  for (const rel of all) {
    const cls = classify(rel);
    byClass[cls].total++;
    if (includedPaths.has(rel)) byClass[cls].examined++;
  }

  return {
    path: extDir,
    totalFiles: all.length,
    llmInputFiles: includedPaths.size,
    byClass,
  };
}

function aggregate(reports: ExtensionReport[]): Record<FileClass, PerClassCount> {
  const agg: Record<FileClass, PerClassCount> = {
    js_ts: { total: 0, examined: 0 },
    manifest: { total: 0, examined: 0 },
    shell_script: { total: 0, examined: 0 },
    native_module: { total: 0, examined: 0 },
    wasm: { total: 0, examined: 0 },
    webview: { total: 0, examined: 0 },
    config: { total: 0, examined: 0 },
    doc: { total: 0, examined: 0 },
    asset: { total: 0, examined: 0 },
    lockfile: { total: 0, examined: 0 },
    other: { total: 0, examined: 0 },
  };
  for (const r of reports) {
    for (const k of Object.keys(agg) as FileClass[]) {
      agg[k].total += r.byClass[k].total;
      agg[k].examined += r.byClass[k].examined;
    }
  }
  return agg;
}

function formatPct(examined: number, total: number): string {
  if (total === 0) return '   -   ';
  const pct = (examined / total) * 100;
  return pct.toFixed(1).padStart(5) + '%';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: tsx reproducer/measure-vsix-coverage.ts <extension-dir>... [--recursive]');
    process.exit(2);
  }
  const targets = resolveTargets(args);
  if (targets.length === 0) {
    console.error('[error] no extension directories resolved');
    process.exit(2);
  }
  console.error(`[info] measuring ${targets.length} extension(s)`);

  const reports: ExtensionReport[] = [];
  for (const t of targets) {
    try {
      const r = await measure(t);
      reports.push(r);
      console.error(`[info] ${basename(t)} — ${r.totalFiles} files, ${r.llmInputFiles} in LLM input`);
    } catch (err) {
      console.error(`[warn] failed to measure ${t}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const agg = aggregate(reports);

  // Markdown-style table to stdout for easy paste-in.
  console.log('');
  console.log(`# VSIX coverage measurement — ${reports.length} extension(s)`);
  console.log('');
  console.log('| file class      | total |  in LLM input | coverage |');
  console.log('|-----------------|------:|--------------:|---------:|');
  for (const k of Object.keys(agg) as FileClass[]) {
    const v = agg[k];
    console.log(
      `| ${k.padEnd(15)} | ${String(v.total).padStart(5)} | ${String(v.examined).padStart(13)} | ${formatPct(v.examined, v.total)} |`,
    );
  }
  const total = Object.values(agg).reduce((s, x) => s + x.total, 0);
  const examined = Object.values(agg).reduce((s, x) => s + x.examined, 0);
  console.log(`| **total**       | ${String(total).padStart(5)} | ${String(examined).padStart(13)} | ${formatPct(examined, total)} |`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
