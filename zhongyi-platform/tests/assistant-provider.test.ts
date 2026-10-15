import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResponsesProvider, providerFromEnv, ProviderError, type ModelInput } from '../server/assistant-provider.js';
import { isAssistantMode, supportsAssistantMode } from '../shared/assistant-tasks.js';

const input: ModelInput = { ingredient: '测试食材', excerpts: [{ evidenceId: 'fixture-id', title: '测试来源', locator: '第 1 页', text: '测试部位为根。' }] };
const value = { statements: [{ evidenceId: 'fixture-id', quote: '测试部位为根。' }], gaps: ['safety_boundary'] };
const body = (output: unknown[] = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }]) => ({ status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20 } });
const transport = (response: () => Response): typeof fetch => async () => response();
const signal = () => new AbortController().signal;

test('task capabilities preserve legacy extract/summary providers and reject unsupported review modes', () => {
  const config = { ...providerFromEnv({}).config };
  for (const scope of ['editorial_extracts_only', 'editorial_extracts_and_summary', 'editorial_extracts_summary_and_review'] as const) {
    config.scope = scope; assert.equal(supportsAssistantMode(config, 'extract'), true);
    assert.equal(supportsAssistantMode(config, 'summary'), scope !== 'editorial_extracts_only');
    assert.equal(supportsAssistantMode(config, 'review'), scope === 'editorial_extracts_summary_and_review');
  }
  for (const value of ['extract', 'summary', 'review']) assert.equal(isAssistantMode(value), true);
  for (const value of [null, {}, 1, 'diagnosis', 'Review']) assert.equal(isAssistantMode(value), false);
});

test('review Responses request has a closed three-field findings schema, fixed source versions and no external call', async () => {
  const review: ModelInput = { ...input, mode: 'review', excerpts: input.excerpts.map((item) => ({ ...item, source: { id: 'test-source', revision: 2 } })) };
  const output = { statements: [], findings: ['identity', 'edible_part', 'processing'].map((field) => ({ field, kind: 'gap', text: '资料缺口。', evidenceIds: [] })) };
  const fake: typeof fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string); const schema = request.text.format.schema;
    assert.equal(request.text.format.name, 'editorial_review'); assert.equal(request.text.format.strict, true);
    assert.equal(request.max_output_tokens, 2600); assert.deepEqual(schema.required, ['statements', 'findings']);
    assert.deepEqual(Object.keys(schema.properties).sort(), ['findings', 'statements']); assert.equal(schema.additionalProperties, false);
    const findings = schema.properties.findings; assert.equal(findings.minItems, 3); assert.equal(findings.maxItems, 3);
    assert.equal(findings.items.additionalProperties, false); assert.deepEqual(findings.items.required, ['field', 'kind', 'text', 'evidenceIds']);
    assert.deepEqual(findings.items.properties.kind.enum, ['candidate', 'gap', 'conflict']);
    assert.deepEqual(findings.items.properties.evidenceIds.items.enum, ['fixture-id']);
    assert.deepEqual(JSON.parse(request.input[1].content), review); assert.match(request.input[0].content, /不同来源/);
    assert.equal(request.store, false); assert.deepEqual(request.tools, []);
    return Response.json(body([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] }]));
  };
  assert.deepEqual((await createResponsesProvider('test-key-not-real', 'explicit-test-model', fake).generate(review, signal())).value, output);
});

test('Responses adapter uses fixed HTTPS, strict schema, store:false and a minimal request; no real network occurs', async () => {
  let calls = 0;
  const fake: typeof fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer test-key-not-real');
    const request = JSON.parse(options!.body as string); assert.equal(request.model, 'explicit-test-model');
    assert.equal(request.store, false); assert.equal(request.background, false); assert.equal(request.stream, false); assert.deepEqual(request.tools, []);
    assert.equal(request.text.format.strict, true); assert.equal(request.text.format.type, 'json_schema');
    assert.deepEqual(request.text.format.schema.properties.statements.items.properties.evidenceId.enum, ['fixture-id']);
    assert.deepEqual(JSON.parse(request.input[1].content), input); assert.equal(JSON.stringify(request).includes('test-key-not-real'), false);
    return Response.json(body([{ type: 'reasoning' }, ...body().output]));
  };
  const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', fake);
  const result = await provider.generate(input, signal()); assert.equal(calls, 1); assert.deepEqual(result.value, value);
  assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 20); assert.equal(result.estimatedCostUsd, null);
});

test('adapter refuses incomplete/refusal/tool/malformed/oversized output and never forwards upstream secret errors', async () => {
  const cases: [Response, string][] = [
    [Response.json({ ...body(), status: 'incomplete' }), 'incomplete_response'],
    [Response.json(body([{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'upstream-secret' }] }])), 'model_refused'],
    [Response.json(body([{ type: 'function_call', name: 'unsafe_tool' }])), 'invalid_response'],
    [Response.json(body([null])), 'invalid_response'],
    [Response.json(body([{ type: 'message', role: 'assistant', content: [null] }])), 'invalid_response'],
    [Response.json(body([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'not JSON upstream-secret' }] }])), 'invalid_response'],
    [new Response('invalid JSON upstream-secret'), 'invalid_response'],
    [new Response('x'.repeat(65537)), 'response_too_large'],
    [new Response('upstream-secret', { status: 429 }), 'provider_rate_limited'],
    [new Response('upstream-secret', { status: 500 }), 'provider_unavailable']
  ];
  for (const [response, code] of cases) {
    const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', transport(() => response));
    await assert.rejects(provider.generate(input, signal()), (error: unknown) => error instanceof ProviderError && error.code === code && !error.message.includes('upstream-secret'));
  }
  const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', async () => { throw new Error('upstream-secret'); });
  await assert.rejects(provider.generate(input, signal()), (error: unknown) => error instanceof ProviderError && error.code === 'provider_unavailable');
});

test('unknown network envelopes are narrowed before use; malformed output keeps verified usage only', async () => {
  const cases: unknown[] = [null, [], 'upstream-secret', 42, true,
    { ...body(), output: null }, { ...body(), output: {} },
    body([[]]), body([{ type: 'message', role: 'assistant', content: {} }]),
    body([{ type: 'message', role: 'assistant', content: [[]] }]), body([]),
    body([...body().output, ...body().output]),
    body([{ type: 'message', role: 'user', content: [{ type: 'output_text', text: JSON.stringify(value) }] }])];
  for (const candidate of cases) {
    const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', transport(() => Response.json(candidate)));
    await assert.rejects(provider.generate(input, signal()), (error: unknown) => {
      assert.ok(error instanceof ProviderError); assert.equal(error.code, 'invalid_response');
      assert.equal(error.message.includes('upstream-secret'), false);
      if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
        assert.deepEqual(error.usage, { inputTokens: 100, outputTokens: 20, estimatedCostUsd: null });
      } else { assert.equal(error.usage, undefined); }
      return true;
    });
  }
});

test('unknown or malformed usage never becomes zero cost; extra upstream fields remain compatible', async () => {
  for (const usage of [undefined, null, [], 'upstream-secret', { input_tokens: '100', output_tokens: 1.5 }]) {
    const candidate = { ...body(), usage, future_field: { retainedUpstreamOnly: true } };
    const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', transport(() => Response.json(candidate)), { input: 1, output: 2 });
    assert.deepEqual(await provider.generate(input, signal()), { value, inputTokens: null, outputTokens: null, estimatedCostUsd: null });
  }
});

test('cost is unknown without explicit prices; invalid counts are not trusted; no model/key/permission defaults', async () => {
  const provider = createResponsesProvider('test-key-not-real', 'explicit-test-model', transport(() => Response.json(body())), { input: 1, output: 2 });
  assert.equal((await provider.generate(input, signal())).estimatedCostUsd, 0.00014);
  const unknown = createResponsesProvider('test-key-not-real', 'explicit-test-model', transport(() => Response.json({ ...body(), usage: { input_tokens: -1, output_tokens: Number.MAX_SAFE_INTEGER + 1 } })), { input: 1, output: 2 });
  const result = await unknown.generate(input, signal()); assert.equal(result.inputTokens, null); assert.equal(result.outputTokens, null); assert.equal(result.estimatedCostUsd, null);
  assert.equal(providerFromEnv({}).config.enabled, false);
  for (const env of [{ AI_PROVIDER: 'openai' }, { AI_PROVIDER: 'test-fixture' }, { AI_PROVIDER: 'openai', AI_EXTERNAL_ENABLED: 'true', OPENAI_API_KEY: 'test-key-not-real' },
    { AI_PROVIDER: 'openai', AI_EXTERNAL_ENABLED: 'true', OPENAI_API_KEY: 'test-key-not-real', AI_MODEL: 'explicit-test-model', AI_INPUT_USD_PER_MILLION: 'bad' }]) assert.throws(() => providerFromEnv(env));
  assert.throws(() => createResponsesProvider('test\nkey', 'explicit-test-model'));
});

test('summary Responses request has a separate closed schema and source-bound section refs without a real call', async () => {
  const summary: ModelInput = { ...input, mode: 'summary' };
  const output = { ...value, sections: [{ field: 'edible_part', text: '记录中的部位是根。', evidenceIds: ['fixture-id'] }] };
  const fake: typeof fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string); const schema = request.text.format.schema;
    assert.equal(request.text.format.name, 'editorial_summary'); assert.equal(request.max_output_tokens, 2600);
    assert.deepEqual(schema.required, ['statements', 'gaps', 'sections']); assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.sections.items.required, ['field', 'text', 'evidenceIds']); assert.equal(schema.properties.sections.items.additionalProperties, false);
    assert.deepEqual(schema.properties.sections.items.properties.evidenceIds.items.enum, ['fixture-id']);
    assert.deepEqual(JSON.parse(request.input[1].content), summary); assert.match(request.input[0].content, /限定|条件/); assert.match(request.input[0].content, /冲突/);
    assert.equal(request.store, false); assert.deepEqual(request.tools, []);
    return Response.json(body([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] }]));
  };
  const result = await createResponsesProvider('test-key-not-real', 'explicit-test-model', fake).generate(summary, signal()); assert.deepEqual(result.value, output);
});
