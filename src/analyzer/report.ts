/**
 * Markdown report generator
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AnalysisResult, Finding } from '../types/index.js';
import { getEndpointFiltering } from './patterns.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface CategoryCounts {
  total: number; critical: number; high: number; medium: number; low: number; fp: number;
}

function groupByCategory(findings: Finding[]): Record<string, { counts: CategoryCounts; items: Finding[] }> {
  const groups: Record<string, { counts: CategoryCounts; items: Finding[] }> = {};
  for (const f of findings) {
    if (!groups[f.category]) {
      groups[f.category] = { counts: { total: 0, critical: 0, high: 0, medium: 0, low: 0, fp: 0 }, items: [] };
    }
    const g = groups[f.category];
    g.items.push(f);
    g.counts.total++;
    if (f.isFalsePositive) g.counts.fp++;
    const risk = f.riskLevel?.toLowerCase() || 'low';
    if (risk === 'critical') g.counts.critical++;
    else if (risk === 'high') g.counts.high++;
    else if (risk === 'medium') g.counts.medium++;
    else g.counts.low++;
  }
  return groups;
}

function tryParseHostPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch { return null; }
}

export interface ReportOptions {
  fullOutput?: boolean;
  hideFalsePositives?: boolean;
  showFalsePositives?: boolean;
}

export class ReportGenerator {
  private result: AnalysisResult;
  private options: ReportOptions;
  
  private readonly LIMIT_FINDINGS_PER_CAT = 25;
  private readonly LIMIT_ENDPOINTS = 100;
  private readonly LIMIT_EVIDENCE_CHARS = 1500;
  
  constructor(result: AnalysisResult, options: ReportOptions = {}) {
    this.result = result;
    this.options = options;
  }
  
  generate(): string {
    const sections = [
      this.header(),
      this.executiveSummary(),
      this.findingsSummary(),
      this.metadata(),
      this.fileInventory(),
      this.binaryHashes(),
      this.endpoints(),
      this.findings(),
    ];

    return sections.filter(Boolean).join('\n');
  }
  
  private header(): string {
    const extensionName = this.result.extensionName || 'Unknown';
    const version = this.result.version || '0.0.0';
    const verdict = this.result.verdict;

    let header = `# Extension Analysis: ${extensionName}\n\n`;

    header += `**Analysis Date:** ${this.result.analysisDate}\n`;
    header += `**Extension ID:** ${this.result.extensionId}\n`;
    header += `**Version:** ${version}\n`;
    if (verdict) {
      const descriptions: Record<string, string> = {
        'MALICIOUS': 'Patterns consistent with malicious behavior detected by automated analysis',
        'SUSPICIOUS': 'Elevated risk indicators detected by automated analysis',
        'CLEAN': 'No risk indicators detected by automated analysis',
      };
      header += `**Verdict:** ${verdict} — ${descriptions[verdict] || ''}\n`;
    }
    header += `\n---`;

    return header;
  }
  
  private findingsSummary(): string {
    const findings = this.result.findings;
    if (findings.length === 0) return '';

    const groups = groupByCategory(findings);
    const sorted = Object.entries(groups).sort((a, b) => b[1].counts.total - a[1].counts.total);

    const totals = { critical: 0, high: 0, medium: 0, low: 0, fp: 0 };
    for (const { counts } of Object.values(groups)) {
      totals.critical += counts.critical;
      totals.high += counts.high;
      totals.medium += counts.medium;
      totals.low += counts.low;
      totals.fp += counts.fp;
    }

    const rows = sorted.map(([category, { counts }]) => {
      const label = categoryLabel(category);
      return `| ${label} | ${counts.total} | ${counts.critical || '-'} | ${counts.high || '-'} | ${counts.medium || '-'} | ${counts.low || '-'} | ${counts.fp || '-'} |`;
    });

    const truePositives = findings.length - totals.fp;

    let summary = `
## Findings Summary

**Total findings:** ${findings.length} | **True positives:** ${truePositives} | **False positives:** ${totals.fp}`;

    summary += `

| Category | Total | Critical | High | Medium | Low | FP |
|----------|-------|----------|------|--------|-----|-----|
${rows.join('\n')}
| **Total** | **${findings.length}** | **${totals.critical || '-'}** | **${totals.high || '-'}** | **${totals.medium || '-'}** | **${totals.low || '-'}** | **${totals.fp || '-'}** |

---`;

    return summary;
  }

  private executiveSummary(): string {
    if (!this.result.executiveSummary) return '';
    
    return `
## Executive Summary

${this.result.executiveSummary}

---`;
  }
  
  private metadata(): string {
    const description = this.result.description || '';
    const desc = this.options.fullOutput
      ? description
      : description.slice(0, 200) + (description.length > 200 ? '...' : '');

    const categories = Array.isArray(this.result.categories) ? this.result.categories : [];
    const activationEventsDisplay = this.computeActivationEventsDisplay();

    return `
## Metadata

| Field | Value |
|-------|-------|
| Publisher | ${this.result.publisher || 'Not specified'} |
| Description | ${desc || 'Not specified'} |
| Repository | ${this.result.repository || 'Not specified'} |
| Categories | ${categories.join(', ') || 'None'} |
| Activation Events | ${activationEventsDisplay} |
${this.result.bundledDependencies?.length ? `| Bundled Dependencies | ${this.result.bundledDependencies.join(', ')} |` : ''}
---`;
  }

  /**
   * Compute display string for activation events
   */
  private computeActivationEventsDisplay(): string {
    const activationEvents = Array.isArray(this.result.activationEvents) ? this.result.activationEvents : [];
    const contributes = this.result.contributes as Record<string, unknown> | undefined;

    // If activationEvents has entries, join them with commas
    if (activationEvents.length > 0) {
      return activationEvents.join(', ');
    }

    // Check for contributed commands and views
    const hasCommands = contributes?.commands && Array.isArray(contributes.commands) && contributes.commands.length > 0;
    const hasViews = contributes?.views && Object.keys(contributes.views).length > 0;

    if (hasCommands || hasViews) {
      return 'Implicit (activates via contributed commands and views)';
    }

    // Default: activates on startup
    return '* (activates on startup)';
  }
  
  private fileInventory(): string {
    const rows: string[] = [];
    const stats = this.result.fileStats;
    const categories: Record<string, string> = {
      js: 'JavaScript',
      binary: 'Native Binaries',
      config: 'Configuration',
      asset: 'Assets',
      text: 'Text Files',
      agent_config: 'Agent Config',
    };
    
    let totalCount = 0;
    
    for (const [cat, label] of Object.entries(categories)) {
      const stat = stats[cat];
      if (stat && stat.count > 0) {
        rows.push(`| ${label} | ${stat.count} | ${formatSize(stat.totalSize)} |`);
        totalCount += stat.count;
      }
    }
    
    return `
## File Inventory

| Category | Count | Size |
|----------|-------|------|
${rows.join('\n')}
| **Total** | **${totalCount}** | **${formatSize(this.result.totalSize)}** |

---`;
  }
  
  private binaryHashes(): string {
    if (this.result.binaryHashes.length === 0) {
      return `
### Binary Hashes

No native binaries found.

---`;
    }
    
    const rows = this.result.binaryHashes.map(b => 
      `| \`${b.path}\` | ${b.architecture} | ${formatSize(b.size)} | \`${b.sha256.slice(0, 16)}...\` |`
    );
    
    return `
### Binary Hashes

| File | Architecture | Size | SHA256 |
|------|--------------|------|--------|
${rows.join('\n')}

---`;
  }
  
  private endpoints(): string {
    // Apply endpoint filtering
    const patternsPath = join(__dirname, '..', '..', 'docs', 'patterns.yaml');
    const filteringConfig = getEndpointFiltering(patternsPath);
    const excludedDomains = filteringConfig.excluded_domains || [];
    const excludedUrlPatterns = (filteringConfig.excluded_url_patterns || []).map(
      (p: string) => new RegExp(p, 'i')
    );

    // Helper: check if hostname matches or is subdomain of excluded domain
    const isExcludedDomain = (hostname: string): boolean => {
      const normalized = hostname.toLowerCase();
      return excludedDomains.some(domain => {
        const d = domain.toLowerCase();
        return normalized === d || normalized.endsWith('.' + d);
      });
    };

    // Build package.json metadata URLs to exclude
    const pkgUrls = new Set<string>();
    for (const url of [this.result.repository, this.result.homepage]) {
      if (!url) continue;
      const hostPath = tryParseHostPath(url);
      if (hostPath) pkgUrls.add(hostPath);
    }

    // Filter endpoints
    const filteredEndpoints = this.result.endpoints.filter(ep => {
      try {
        const epUrl = new URL(ep.url);
        const epPath = epUrl.hostname + epUrl.pathname;

        // Filter 1: Skip package.json metadata URLs
        if (pkgUrls.has(epPath) || pkgUrls.has(epUrl.hostname)) {
          return false;
        }

        // Filter 2: Domain filter (operational endpoints bypass this)
        if (!ep.operational && isExcludedDomain(epUrl.hostname)) {
          return false;
        }

        // Filter 3: URL pattern filter
        for (const pattern of excludedUrlPatterns) {
          if (pattern.test(ep.url)) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    });

    if (filteredEndpoints.length === 0) {
      const totalRaw = this.result.endpoints.length;
      if (totalRaw > 0) {
        return `
## External Endpoints

No notable endpoints. ${totalRaw} URL(s) found but excluded (standard infrastructure domains).

---`;
      }
      return `
## External Endpoints

No external URLs found in code.

---`;
    }
    
    // Extract unique domains and count operational endpoints
    const domains = new Set<string>();
    let operationalCount = 0;
    for (const e of filteredEndpoints) {
      if (e.operational) operationalCount++;
      try {
        const url = new URL(e.url);
        domains.add(url.hostname);
      } catch {}
    }

    const limit = this.options.fullOutput ? undefined : this.LIMIT_ENDPOINTS;
    const displayEndpoints = limit ? filteredEndpoints.slice(0, limit) : filteredEndpoints;

    const rows = displayEndpoints.map(e => {
      const urlDisplay = this.options.fullOutput ? e.url : (e.url.length > 80 ? e.url.slice(0, 80) + '...' : e.url);
      const method = e.method || '-';
      const flags = e.operational ? '**active**' : 'ref';
      return `| ${urlDisplay} | ${method} | ${flags} | \`${e.file}:${e.line}\` |`;
    });

    let table = `
## External Endpoints (${filteredEndpoints.length} total)

**Unique domains:** ${domains.size} | **Active network calls:** ${operationalCount} | **References only:** ${filteredEndpoints.length - operationalCount}

| URL | Method | Usage | Location |
|-----|--------|-------|----------|
${rows.join('\n')}`;

    if (limit && this.result.endpoints.length > limit) {
      table += `\n| ... | | | *(${filteredEndpoints.length - limit} more - use --full)* |`;
    }

    return table + '\n---';
  }
  
  private findings(): string {
    const findings = this.options.hideFalsePositives
      ? this.result.findings.filter(f => !f.isFalsePositive)
      : this.result.findings;
    
    if (findings.length === 0) {
      return `
## Findings

No significant security findings detected.

---`;
    }
    
    const groups = groupByCategory(findings);
    const sections: string[] = ['# Findings\n'];

    for (const [category, { items: categoryFindings }] of Object.entries(groups)) {
      const label = categoryLabel(category);
      sections.push(`## ${label} (${categoryFindings.length} findings)\n`);

      const limit = this.options.fullOutput ? undefined : this.LIMIT_FINDINGS_PER_CAT;
      const display = limit ? categoryFindings.slice(0, limit) : categoryFindings;

      for (let i = 0; i < display.length; i++) {
        const f = display[i];
        const num = i + 1;

        sections.push(`#### Finding ${num}: ${f.title}`);
        if (f.isFalsePositive) {
          sections.push('*Likely false positive*');
        }
        sections.push(``);
        sections.push(`**Location:** \`${f.location}\``);
        sections.push(`**Risk Level:** ${f.riskLevel.toUpperCase()}`);
        if (f.probableOrigin && f.probableOrigin !== 'unknown') {
          const originLabel = f.probableOrigin === 'extension_code' ? 'Extension Code'
            : f.probableOrigin === 'bundled_dependency' ? 'Bundled Dependency'
            : f.probableOrigin;
          sections.push(`**Origin:** ${originLabel}`);
        }
        if (f.injectionDetected) {
          sections.push(`**Prompt Injection:** Detected`);
        }
        sections.push(`**Observation:** ${f.observation}`);

        if (f.isFalsePositive && f.falsePositiveReason) {
          sections.push(`**Why likely false positive:** ${f.falsePositiveReason}`);
        }

        if (f.consensus) {
          const votesSummary = f.consensus.votes.map(v => v.riskLevel).join(', ');
          if (f.consensus.unanimous) {
            sections.push(`**Consensus:** Unanimous (${votesSummary})`);
          } else if (f.consensus.splitDecision) {
            sections.push(`**Consensus:** Split decision — votes: [${votesSummary}] → ${f.riskLevel}`);
          } else {
            sections.push(`**Consensus:** Majority (${votesSummary})`);
          }
        }

        sections.push(``);
        sections.push(`**Evidence:**`);
        sections.push('```javascript');
        const evidence = limit && f.evidence.length > this.LIMIT_EVIDENCE_CHARS
          ? f.evidence.slice(0, this.LIMIT_EVIDENCE_CHARS) + '\n// ... truncated'
          : f.evidence;
        sections.push(evidence);
        sections.push('```');
        sections.push('');
      }
      
      if (limit && categoryFindings.length > limit) {
        sections.push(`*... and ${categoryFindings.length - limit} more findings (use --full)*`);
      }
    }
    
    sections.push('---');
    return sections.join('\n');
  }
}
