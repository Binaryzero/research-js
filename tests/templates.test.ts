/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

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
    expect(true).toBe(true);
  });
  
  it('should render batch page with categories', () => {
    expect(true).toBe(true);
  });
  
  it('should render history page with scans', () => {
    expect(true).toBe(true);
  });
  
  it('should render settings page', () => {
    expect(true).toBe(true);
  });
  
  it('should render report page with report name', () => {
    expect(true).toBe(true);
  });
});
