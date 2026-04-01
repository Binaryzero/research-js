# Extension Security Analyzer — Implementation Plan

**Project:** `/Users/william/Tools/research-js`  
**Scope:** All package audit recommendations  
**Convention:** Complete phases in order. Each phase is independently verifiable before proceeding.

---

## Phase 1 — Fix the broken dev toolchain

### 1.1 — Add missing coverage package

`vitest.config.ts` declares `coverage.provider: 'v8'` but `@vitest/coverage-v8` is not installed. Running with `--coverage` throws a hard error.

```bash
npm install -D @vitest/coverage-v8
```

Verify by running `npm test -- --coverage` and confirming the `coverage/` directory is created.

### 1.2 — Move `pino-pretty` to devDependencies

```bash
npm install -D pino-pretty
npm uninstall pino-pretty
```

In `src/index.ts`, find the Fastify instantiation and make the transport conditional so production emits raw JSON:

```typescript
const fastify = Fastify({
  logger: process.env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
});
```

---

## Phase 2 — Migrate providers to the AI SDK

The project currently has two parallel LLM stacks: direct clients (`ollama`, `openai`) and AI SDK wrappers (`ollama-ai-provider`, `@ai-sdk/openai`, `ai`). This phase migrates each provider to the SDK and removes the direct clients. Work entirely inside `src/providers/`. The `LlmProvider` interface is unchanged.

### 2.1 — Migrate `OllamaProvider`

Replace `src/providers/ollama-provider.ts` entirely. The new implementation imports `generateText` from `ai` and creates an Ollama model reference via `ollama-ai-provider`. Before writing the file, verify the exact export shape of `ollama-ai-provider`:

```bash
node -e "import('ollama-ai-provider').then(m => console.log(Object.keys(m)))"
```

The provider exposes a factory function (`createOllama`) and a default instance. Use `createOllama({ baseURL: connection.baseUrl })` to create a client, then pass `client(this.model)` as the model argument to `generateText`. Pass `AbortSignal.timeout(this.conn.timeout)` as the `abortSignal` parameter. `isAvailable()` should check `${baseUrl}/api/tags` with a 5 second timeout rather than calling `this.client.list()`, since `ollama-ai-provider` does not expose a list method.

### 2.2 — Migrate `OpenAIProvider`

Replace `src/providers/openai-provider.ts` entirely. The new implementation imports `createOpenAI` from `@ai-sdk/openai` and `generateText` from `ai`. Construct the client as `createOpenAI({ baseURL: \`\${conn.baseUrl}/v1\`, apiKey: conn.apiKey || 'ollama' })` inside `generate()`. The `isAvailable()` check fetches `${baseUrl}/v1/models` directly with `fetch` rather than going through the SDK, passing the API key as a Bearer token header and timing out after 5 seconds.

### 2.3 — Update provider tests

`tests/ollama-provider.test.ts` currently mocks the `ollama` package. Replace the mock targets with `ollama-ai-provider` and `ai`. Mock `generateText` from `ai` to return `{ text: 'mocked response' }`. Mock the `createOllama` factory from `ollama-ai-provider` to return a jest function. Test assertions should verify that `generateText` was called with the correct `system`, `prompt`, `maxTokens`, and `temperature` values rather than testing raw HTTP.

### 2.4 — Remove direct client packages

After both providers pass their tests:

```bash
npm uninstall ollama openai
npm run typecheck
npm test
```

Confirm no imports remain from the removed packages by searching `src/` and `tests/` for `from 'ollama'` and `from 'openai'`.

---

## Phase 3 — Structured LLM output with `generateObject` and Zod

This phase eliminates the multi-fallback JSON parse chains. The triage batch parser alone has four extraction approaches plus individual object recovery — all of it exists to compensate for malformed LLM output that structured outputs prevent. This phase depends on Phase 2 being complete.

### 3.1 — Define Zod schemas

Create `src/analyzer/schemas.ts`:

```typescript
import { z } from 'zod';

export const AssessmentSchema = z.object({
  risk_level: z.enum(['critical', 'high', 'medium', 'low', 'none']),
  is_false_positive: z.boolean(),
  false_positive_reason: z.string().default(''),
  explanation: z.string(),
  recommendation: z.enum(['investigate', 'likely_benign', 'dismiss']),
  injection_detected: z.boolean().default(false),
});

export const BatchAssessmentSchema = z.array(AssessmentSchema);

export type AssessmentOutput = z.infer<typeof AssessmentSchema>;
export type BatchAssessmentOutput = z.infer<typeof BatchAssessmentSchema>;
```

### 3.2 — Add `generateObject` to the `LlmProvider` interface

Update `src/providers/llm-provider.ts` to add the method signature. Import `ZodSchema` from `zod` rather than `z` to keep the import minimal:

```typescript
import type { ZodSchema } from 'zod';

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, system?: string): Promise<string>;
  generateObject<T>(schema: ZodSchema<T>, prompt: string, system?: string): Promise<T>;
}
```

### 3.3 — Implement `generateObject` in both providers

In each provider, add `generateObject` using `generateObject as aiGenerateObject` imported from `ai` (alias avoids naming collision with the method). The model reference and client construction are identical to the ones used in each provider's `generate()` method — replicate that construction, pass the `schema` parameter, and forward `maxTokens`, `temperature`, and `abortSignal` the same way.

### 3.4 — Replace parse chains in `src/analyzer/llm.ts`

Remove `parseSingleAssessment`, `parseBulkAssessments`, and the entire four-approach fallback block inside `triageBatchAssess`. Update all call sites:

`assessFinding` and `processFileGroupForStrategic` call `this.provider.generateObject(AssessmentSchema, user, system)` instead of `this.generate(user, system)` followed by `parseSingleAssessment`.

The triage batch loop calls `this.provider.generateObject` with an extended schema that includes an `index` field: `BatchAssessmentSchema.element.extend({ index: z.number() }).array()`. Map each returned item to `results[item.index]` directly, converting snake_case fields to the `LlmAssessment` shape.

`bulkAssessAllFindings` calls `this.provider.generateObject(BatchAssessmentSchema, user, system)` instead of `this.generate` followed by `parseBulkAssessments`.

`parseStrategicAssessments` in `llm-batch.ts` remains unchanged for now. The strategic bulk prompt sends a positional array without an `index` field, which is a different contract. Wrap it in a try/catch and leave it as-is; it is a future cleanup target once the other paths are confirmed stable.

Run `npm run typecheck && npm test` after this step.

---

## Phase 4 — Config validation with Zod

`config.json` is loaded as a raw `JSON.parse` cast with no validation. A partially-written file produces silent wrong behavior.

### 4.1 — Define the config schema

Add to `src/analyzer/schemas.ts` or a new file `src/schemas/config.ts`:

```typescript
import { z } from 'zod';

const ModelSlotSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  provider: z.enum(['ollama', 'openai']),
  model: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  timeout: z.number().min(1000),
  maxTokens: z.number().min(100),
  temperature: z.number().min(0).max(2),
});

export const AppConfigSchema = z.object({
  version: z.string(),
  main: ModelSlotSchema,
  judges: z.array(ModelSlotSchema),
  consensus: z.object({ judgesValidateAllFindings: z.boolean() }),
  assessmentMode: z.enum(['strategic', 'bulk']),
  promptProfile: z.string(),
  concurrency: z.number().min(1).max(50),
  defaultNoLlm: z.boolean(),
  defaultFull: z.boolean(),
});
```

### 4.2 — Apply in `loadAppConfig`

In `src/config.ts`, find the `JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<AppConfig>` cast inside `loadAppConfig`. Replace it with a validated parse that falls back to defaults on failure and logs specific field errors:

```typescript
const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
const validated = AppConfigSchema.partial().safeParse(raw);
if (!validated.success) {
  console.warn('[Config] config.json failed validation, using defaults:',
    validated.error.flatten().fieldErrors);
} else {
  appConfig = { ...appConfig, ...validated.data };
}
```

Run `npm run typecheck && npm test` after this step. This phase is independent of Phase 3 and can run in parallel if working across branches.

---

## Phase 5 — Replace `GlobalConcurrencyLimiter` with `p-limit`

The singleton has a silent bug: `getInstance(maxConcurrent)` ignores the `maxConcurrent` argument on every call after the first. Beyond correctness, the current invocation pattern in `strategicAssessFindings` submits tasks serially despite having a limiter — each task is awaited before the next is submitted, so the queue never holds more than one item.

### 5.1 — Install

```bash
npm install p-limit
```

### 5.2 — Update `src/analyzer/llm.ts`

Remove the entire `GlobalConcurrencyLimiter` class, the `getConcurrencyLimiter()` method, and the `concurrencyLimiter` property and its constructor initialization.

Add `import pLimit from 'p-limit'` at the top of the file.

In `strategicAssessFindings`, create a limiter scoped to the call and submit all file groups simultaneously, allowing the limiter to gate them:

```typescript
const limit = pLimit(this.concurrency);

const allResults = await Promise.all(
  allFileGroups.map(({ pattern, fileGroup }) =>
    limit(() => this.processFileGroupForStrategic(pattern, fileGroup))
  )
);
```

In `processFileGroupForStrategic`, the three consensus calls must fire simultaneously. Replace the sequential loop with:

```typescript
const runs = await Promise.all([0, 1, 2].map(() => this.generate(user, system)));
```

In `triageBatchAssess`, the consensus pass must also fire the two additional votes in parallel. Replace the sequential `resp2` / `resp3` awaits with:

```typescript
const consensusPromises = consensusIndices.map(idx =>
  limit(async () => {
    const { system, user } = this.buildFindingPrompt(findings[idx]);
    const [resp2, resp3] = await Promise.all([
      this.generate(user, system),
      this.generate(user, system),
    ]);
    // merge logic unchanged
  })
);
await Promise.all(consensusPromises);
```

The individual `assessFinding` consensus path (three parallel `generate` calls) already uses `Promise.all` and does not need the limiter — those three calls are the bottleneck themselves, not request count.

Run `npm run typecheck && npm test` after this step.

---

## Phase 6 — Server-side markdown rendering

`marked` and `dompurify` are currently loaded from `cdn.jsdelivr.net` as unversioned globals. If the CDN is unavailable the report view breaks with no fallback. Since the server writes the report files, rendering markdown server-side eliminates the need for client-side sanitization entirely.

### 6.1 — Install

```bash
npm install marked
npm install -D @types/marked
```

### 6.2 — Update the reports API route

In `src/index.ts`, add `import { marked } from 'marked'` at the top. In the `/api/reports/:name` GET handler, add pre-rendered HTML alongside the raw content:

```typescript
const content = readFileSync(reportPath, 'utf-8');
const html = await marked(content, { gfm: true, breaks: false });
return { name, content, html };
```

### 6.3 — Update client-side report rendering

In `assets/templates/index.html`, the `showReportContent` function currently calls `marked.parse` and `DOMPurify.sanitize`. Replace both with direct assignment from the server-rendered `html` field:

```javascript
function showReportContent(name, markdown, html) {
  document.getElementById('report-content').innerHTML = html || '';
}
```

Update all call sites of `showReportContent` to pass the `html` field from the API response.

In `assets/templates/report.html`, apply the same change to the report loading logic.

### 6.4 — Remove CDN dependencies

In `assets/templates/base.html`, remove the two `<script>` tags that load `marked` and `dompurify` from `cdn.jsdelivr.net`.

In `assets/static/app.js`, remove the `/* global DOMPurify, marked */` comment at the top of the file.

Run `npm run typecheck && npm test`, then start the dev server and confirm report pages render correctly.

---

## Phase 7 — Replace Nunjucks with Eta

Nunjucks is stagnant and weighs roughly 150KB with its dependency tree. Eta is TypeScript-native, actively maintained, around 6KB, and `@fastify/view` supports it natively. The six templates use only basic Nunjucks features, making the migration mechanical.

### 7.1 — Install and remove

```bash
npm install eta
npm uninstall nunjucks
npm uninstall -D @types/nunjucks
```

### 7.2 — Update `src/index.ts`

Replace the Nunjucks setup with Eta:

```typescript
// Remove
import nunjucks from 'nunjucks';
nunjucks.configure(TEMPLATES_DIR, { autoescape: true, watch: false, noCache: true });

// Add
import { Eta } from 'eta';
const eta = new Eta({ views: TEMPLATES_DIR, cache: false, autoEscape: true });

// Update the view plugin registration
await fastify.register(viewPlugin, {
  engine: { eta },
  root: TEMPLATES_DIR,
  viewExt: 'html',
});
```

### 7.3 — Convert all six templates

The Nunjucks-to-Eta syntax translation is mechanical. Apply these substitutions across all files in `assets/templates/`:

| Nunjucks | Eta |
|---|---|
| `{% extends "base.html" %}` | `<%~ include('base.html', it) %>` |
| `{% block title %}Text{% endblock %}` | Pass as template variable from route handler |
| `{% block content %}...{% endblock %}` | Pass as template variable from route handler |
| `{{ variable }}` | `<%= it.variable %>` |
| `{% if condition %}` | `<% if (it.condition) { %>` |
| `{% endif %}` | `<% } %>` |
| `{% for item in items %}` | `<% for (const item of it.items) { %>` |
| `{% endfor %}` | `<% } %>` |

Eta does not have Jinja2-style block inheritance. Convert `base.html` to accept `it.title`, `it.content`, and `it.scripts` as variables and render them inline. Each page template becomes a standalone file that computes its content section and passes it to the base layout through Eta's `include`.

The nav active-state check currently reads `request.url.path` inside the template. Move this to the route handler by passing `currentPath` explicitly in each `reply.view()` call:

```typescript
fastify.get('/', async (request, reply) => {
  return reply.view('index', { currentPath: request.url });
});
```

Then in the template: `<% if (it.currentPath === '/') { %>aria-current="page"<% } %>`.

After converting all templates, run `npm run typecheck && npm test`, then navigate to every route in the dev server to confirm rendering.

---

## Phase 8 — Final verification

### Dependency check

Run `npm ls --depth=0` and confirm the following packages are absent: `ollama`, `openai`, `nunjucks`, `@types/nunjucks`, `undici`. Confirm the following are present in `dependencies`: `@ai-sdk/openai`, `ai`, `eta`, `marked`, `ollama-ai-provider`, `p-limit`, `zod`. Confirm `@vitest/coverage-v8` and `pino-pretty` are in `devDependencies`.

### TypeScript

```bash
npm run typecheck
```

The `noUnusedLocals` and `noUnusedParameters` flags in `tsconfig.json` will surface any dead imports or variables left over from removed code.

### Full test suite with coverage

```bash
npm test -- --coverage
```

All tests green, coverage report generated.

### Production build

```bash
npm run build
NODE_ENV=production npm start
```

Confirm pino logs emit as raw JSON rather than pretty-printed.

---

## Phase ordering rationale

Phases 1 and 2 are prerequisites for all subsequent work. The broken test toolchain (Phase 1) must be resolved before any phase can be reliably verified. The dual-stack redundancy (Phase 2) must resolve before Phase 3, which adds `generateObject` to the provider interface — that interface change would need implementing twice otherwise.

Phase 3 depends on Phase 2. Phase 4 is independent of Phases 3, 5, 6, and 7 and can run concurrently with any of them. Phases 5, 6, and 7 are fully independent of each other and of Phase 3 — they touch disjoint parts of the codebase and can be executed in any order after Phase 2 completes.
