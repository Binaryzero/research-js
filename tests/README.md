<!-- SCOPE: Test strategy, structure, and conventions -->

# Test Documentation

Test strategy and conventions for the Extension Security Analyzer.

## Overview

| Metric | Value |
|--------|-------|
| Framework | Vitest 4.0.x |
| Total tests | 205 |
| Test files | 14 |
| Shared fixtures | `tests/fixtures.ts` |
| Run command | `npm test` |
| Watch mode | `npm run test:watch` |

## Test Categories

### Pure Function Tests (no mocks)

| File | Tests | Target Module |
|------|-------|---------------|
| `llm-batch.test.ts` | 34 | Finding grouping, sampling, prompt building, response parsing |
| `url-parsing.test.ts` | 27 | Marketplace URL parsing, search URL parameters |
| `fast-assessor.test.ts` | 22 | Heuristic false positive detection (license, test files) |
| `llm-consensus.test.ts` | 21 | Verdict parsing, majority vote, consensus merging |
| `templates.test.ts` | 18 | Nunjucks template rendering and JS function existence |
| `config-pure.test.ts` | 15 | Config slot conversion, prompt profile merging |

### Mocked Unit Tests

| File | Tests | Target Module | Mock Strategy |
|------|-------|---------------|---------------|
| `api.test.ts` | 14 | Fastify API routes | `fastify.inject()`, `vi.mock` for `saveAppConfig` |
| `report.test.ts` | 8 | Report markdown generation | Mock `getEndpointFiltering` |
| `ollama-provider.test.ts` | 7 | LLM HTTP transport | `vi.stubGlobal('fetch')` |
| `llm-client.test.ts` | 6 | LLM client orchestration | Custom `MockLlmProvider` |
| `consensus-orchestrator.test.ts` | 3 | Multi-model consensus | Multiple mock providers |
| `config-io.test.ts` | 3 | Config file read/write | `vi.mock('fs')` |

### Integration Tests

| File | Tests | Scope |
|------|-------|-------|
| `integration.test.ts` | 7 | Full scan pipeline, search, history, scoring, batch, cancel |
| `analyzer.test.ts` | 20 | Static analysis with real pattern matching on test fixtures |

## Test Fixtures

`tests/fixtures.ts` provides factory functions for test data:

| Factory | Returns |
|---------|---------|
| `makeFinding()` | Complete `Finding` object with sensible defaults |
| `makeAnalysisResult()` | Complete `AnalysisResult` with findings, metadata |
| `makeAppConfig()` | Valid `AppConfig` with main model and judges |
| `makeLlmConfig()` | LLM configuration for provider tests |
| `makeModelSlot()` | Single model slot configuration |

## Conventions

| Convention | Rule |
|-----------|------|
| Isolation | Each test creates temp dirs in `/tmp/test-*` or `.temp-test/`, cleans up in `afterEach` |
| No real config writes | `api.test.ts` mocks `saveAppConfig` to prevent overwriting `config.json` |
| No real network | Provider tests mock `fetch`; integration tests use `fastify.inject()` |
| No external services | All Ollama/Marketplace calls are mocked or use injected requests |
| Fixture reuse | Use `fixtures.ts` factories instead of inline test objects |

## Running Tests

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests once |
| `npm run test:watch` | Run in watch mode (re-run on file changes) |
| `npx vitest run tests/api.test.ts` | Run a single test file |
| `npx vitest run -t "should parse"` | Run tests matching a name pattern |

## Maintenance

| Trigger | Action |
|---------|--------|
| New test file added | Add to appropriate category table, update totals |
| Test convention changed | Update Conventions table |
| New factory function added | Add to Test Fixtures table |

Last Updated: 2026-03-22
