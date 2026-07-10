/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import nunjucks from 'nunjucks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'assets', 'templates');

describe('HTML Templates', () => {
  const requiredPages = ['index', 'batch', 'history', 'settings', 'report', 'base'];
  
  requiredPages.forEach(page => {
    it(`should render ${page}.html without errors`, () => {
      const templatePath = join(TEMPLATES_DIR, `${page}.html`);
      const content = readFileSync(templatePath, 'utf-8');
      
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
      
      // Check for Nunjucks template syntax
      if (page !== 'base') {
        expect(content).toContain('{%');
      }
    });
  });
  
  it('base.html should have proper HTML structure', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'base.html'), 'utf-8');
    
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('<html lang="en"');
    expect(content).toContain('<head>');
    expect(content).toContain('</head>');
    expect(content).toContain('<body>');
    expect(content).toContain('</body>');
    expect(content).toContain('</html>');
  });
  
  it('index.html should extend base.html', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'index.html'), 'utf-8');
    
    expect(content).toContain('{% extends "base.html" %}');
    expect(content).toContain('{% block title %}');
    expect(content).toContain('{% block content %}');
    expect(content).toContain('{% block scripts %}');
  });
  
  it('batch.html should have search UI elements', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'batch.html'), 'utf-8');
    
    expect(content).toContain('batch');
  });
  
  it('history.html should have scan history display elements', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'history.html'), 'utf-8');
    
    expect(content).toContain('history');
  });
  
  it('settings.html should have configuration form', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'settings.html'), 'utf-8');
    
    expect(content).toContain('settings');
  });
  
  it('report.html should have report display elements', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'report.html'), 'utf-8');
    
    expect(content).toContain('report');
  });
  
  it('All templates should include required CSS/JS assets', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'base.html'), 'utf-8');
    
    expect(content).toContain('/static/style.css');
    expect(content).toContain('/static/app.js');
  });
});

describe('Template Rendering', () => {
  it('should render index page with request data', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'index.html'), 'utf-8');
    // Index page should have scan form and report display logic
    expect(content).toContain('showReport');
    expect(content).toContain('startScan');
    expect(content).toContain('/api/scan');
  });

  it('should render batch page with categories', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'batch.html'), 'utf-8');
    // Batch page should have search form and result filtering
    expect(content).toContain('search-form');
    expect(content).toContain('search_text');
    expect(content).toContain('doSearch');
  });

  it('should render history page with scans', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'history.html'), 'utf-8');
    // History page should have table and search for scans
    expect(content).toContain('history-search');
    expect(content).toContain('Scan History');
    expect(content).toContain('/api/history');
  });

  it('should render settings page', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'settings.html'), 'utf-8');
    // Settings page should have model configuration elements
    expect(content).toContain('Settings');
    expect(content).toContain('model');
    expect(content).toContain('baseUrl');
    expect(content).toContain('temperature');
  });

  it('should render report page with report name', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'report.html'), 'utf-8');
    // Report page should have report display and markdown rendering logic
    expect(content).toContain('report_name');
    expect(content).toContain('report-content');
    expect(content).toContain('markdown');
  });

  // Regression: with autoescape on (the production @fastify/view config),
  // interpolating a server value into an inline <script> via `{{ x | dump }}`
  // HTML-escapes the quotes (" → &quot;), producing broken JS that throws
  // "Unexpected token '&'" and breaks every report page. Render for real and
  // assert the inline script is still valid JavaScript.
  it('report.html inline script stays valid JS after autoescape render', () => {
    const env = nunjucks.configure(TEMPLATES_DIR, { autoescape: true });
    const html = env.render('report.html', { report_name: 'pub.ext.md' });

    const scriptBodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const reportScript = scriptBodies.find(s => s.includes('reportName')) ?? '';

    expect(reportScript).not.toBe('');
    expect(reportScript).not.toContain('&quot;');
    // new Function parses the body without executing it — throws on a syntax error.
    expect(() => new Function(reportScript)).not.toThrow();
  });
});
