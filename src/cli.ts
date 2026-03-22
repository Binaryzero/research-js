#!/usr/bin/env node
/**
 * CLI entry point for the Extension Security Analyzer
 */

import { existsSync, writeFileSync } from 'fs';
import { parseArgs } from 'util';

import { getConfig } from './config.js';
import { StaticAnalyzer, extractVsix } from './analyzer/static.js';
import { LlmClient, parseVerdictFromSummary } from './analyzer/llm.js';
import { ReportGenerator } from './analyzer/report.js';
import { calculateSuspicionScore, getRiskLabel } from './analyzer/scoring.js';

const { values, positionals } = parseArgs({
  options: {
    output: { type: 'string', short: 'o' },
    model: { type: 'string', short: 'm', default: 'llama3.2' },
    'no-llm': { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    json: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Extension Security Analyzer (TypeScript)

Usage: analyzer <path> [options]

Arguments:
  path                Path to VSIX file or unpacked extension directory

Options:
  -o, --output FILE   Output file for report (default: stdout)
  -m, --model MODEL   LLM model to use (default: llama3.2)
  --no-llm            Skip LLM analysis (static only)
  -v, --verbose       Verbose output
  --json              Output as JSON
  --full              Show all findings without truncation
  -h, --help          Show this help

Examples:
  analyzer extension.vsix
  analyzer ./unpacked-extension/ -o report.md
  analyzer extension.vsix -m codellama -v
  `);
  process.exit(0);
}

const inputPath = positionals[0];

if (!inputPath) {
  console.error('Error: No input path specified');
  console.error('Use --help for usage information');
  process.exit(1);
}

if (!existsSync(inputPath)) {
  console.error(`Error: Path not found: ${inputPath}`);
  process.exit(1);
}

async function main() {
  const config = await getConfig();
  const verbose = values.verbose;
  
  // Handle VSIX extraction
  let extensionPath = inputPath;
  if (inputPath.endsWith('.vsix')) {
    if (verbose) console.log(`Extracting VSIX: ${inputPath}`);
    extensionPath = extractVsix(inputPath);
    if (verbose) console.log(`Extracted to: ${extensionPath}`);
  }
  
  // Static analysis
  if (verbose) console.log('Running static analysis...');
  const analyzer = new StaticAnalyzer(extensionPath, { verbose });
  const result = await analyzer.analyze();
  if (verbose) console.log(`Found ${result.findings.length} findings, ${result.endpoints.length} endpoints`);
  
  // LLM enhancement
  let llm: LlmClient | null = null;
  
  if (!values['no-llm']) {
    llm = new LlmClient({
      ...config.llm,
      model: values.model,
    });
    
    const available = await llm.isAvailable();
    
    if (available) {
      if (result.findings.length > 0) {
        if (verbose) console.log(`LLM analyzing ${result.findings.length} findings...`);

        const assessments = await llm.batchAssessFindings(result.findings, {
          onProgress: (p, m) => verbose && console.log(`  [${Math.round(p * 100)}%] ${m}`),
          extensionName: result.extensionName,
        });

        for (let i = 0; i < result.findings.length; i++) {
          const assessment = assessments[i];
          if (assessment) {
            result.findings[i].riskLevel = assessment.riskLevel;
            result.findings[i].isFalsePositive = assessment.isFalsePositive;
            result.findings[i].falsePositiveReason = assessment.falsePositiveReason;
            if (assessment.recommendation) result.findings[i].recommendation = assessment.recommendation;
            if (assessment.injectionDetected) result.findings[i].injectionDetected = assessment.injectionDetected;
            if (assessment.consensus) result.findings[i].consensus = assessment.consensus;
          }
        }
      }

      if (verbose) console.log('Generating executive summary...');
      const summary = await llm.generateExecutiveSummary(result, extensionPath);
      if (summary) {
        const { verdict, prose } = parseVerdictFromSummary(summary);
        result.verdict = verdict;
        result.executiveSummary = prose;
      } else {
        result.executiveSummary = null;
      }
    } else {
      if (verbose) console.log('LLM not available');
      llm = null;
    }
  }
  
  // Calculate score
  const [score, breakdown] = calculateSuspicionScore(result, { adjustForLlm: !!llm });
  
  if (verbose) {
    console.log(`Score: ${score} (${getRiskLabel(score)})`);
    console.log(`  Findings: ${breakdown.findingsScore}`);
    console.log(`  Structural: ${breakdown.structuralScore}`);
  }
  
  // Output
  let output: string;
  
  if (values.json) {
    output = JSON.stringify({
      ...result,
      score,
      riskLabel: getRiskLabel(score),
      breakdown,
    }, null, 2);
  } else {
    const generator = new ReportGenerator(result, { fullOutput: values.full });
    output = generator.generate();
  }
  
  if (values.output) {
    writeFileSync(values.output, output);
    console.log(`Report written to: ${values.output}`);
  } else {
    console.log(output);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
