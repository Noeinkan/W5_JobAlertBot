import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Force the LLM module to load with a known-bad host and short timeout before
// it is imported. The test then exercises the circuit breaker over real HTTP
// failures so we don't have to mock axios.
const STUB_HOST = '127.0.0.1';
let stubPort = 0;
let stubServer = null;
let requestCount = 0;
let nextBehavior = 'http500';

function startStubServer() {
  return new Promise((resolve, reject) => {
    stubServer = http.createServer((req, res) => {
      requestCount += 1;
      if (nextBehavior === 'http500') {
        res.statusCode = 500;
        res.end('boom');
        return;
      }
      if (nextBehavior === 'hang') {
        // Never reply — let axios time out.
        return;
      }
      if (nextBehavior === 'ok') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ response: JSON.stringify({ rating: 'Green', score: 10, reason: 'r', fitSummary: 'f' }) }));
        return;
      }
      if (nextBehavior === 'garbage') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ response: 'not-json-at-all' }));
        return;
      }
      res.statusCode = 500;
      res.end('boom');
    });
    stubServer.on('error', reject);
    stubServer.listen(0, STUB_HOST, () => {
      stubPort = stubServer.address().port;
      resolve();
    });
  });
}

function stopStubServer() {
  return new Promise((resolve) => {
    if (!stubServer) return resolve();
    stubServer.close(() => resolve());
  });
}

process.env.OLLAMA_HOST = `http://${STUB_HOST}:0`; // overwritten after listen
process.env.OLLAMA_ENABLED = 'true';
process.env.OLLAMA_TIMEOUT_MS = '200';
process.env.OLLAMA_MAX_TOKENS = '60';
process.env.OLLAMA_MODEL = 'test-model';
process.env.LLM_CIRCUIT_BREAKER_THRESHOLD = '3';

let analyzeJobWithLLM;
let shouldCallLLM;
let isLLMCircuitOpen;
let resetLLMCircuitBreaker;

before(async () => {
  await startStubServer();
  process.env.OLLAMA_HOST = `http://${STUB_HOST}:${stubPort}`;
  // Dynamic import after env is finalised and the stub is listening.
  const mod = await import(`../src/utils/llm.js?case=${stubPort}`);
  analyzeJobWithLLM = mod.analyzeJobWithLLM;
  shouldCallLLM = mod.shouldCallLLM;
  isLLMCircuitOpen = mod.isLLMCircuitOpen;
  resetLLMCircuitBreaker = mod.resetLLMCircuitBreaker;
});

after(async () => {
  await stopStubServer();
});

beforeEach(() => {
  nextBehavior = 'http500';
  requestCount = 0;
  resetLLMCircuitBreaker();
});

const fakeJob = (overrides = {}) => ({
  source: 'test',
  title: 'Senior BIM Manager',
  company: 'Test Co',
  description: 'Lead BIM delivery',
  ...overrides,
});

// ---- shouldCallLLM boundary cases ----------------------------------------

test('shouldCallLLM returns false for clearly Red (score <= -10)', () => {
  assert.equal(shouldCallLLM('Red', -10), false);
  assert.equal(shouldCallLLM('Red', -20), false);
  assert.equal(shouldCallLLM('Red', -99), false);
});

test('shouldCallLLM returns false for clearly Green (score >= 18)', () => {
  assert.equal(shouldCallLLM('Green', 18), false);
  assert.equal(shouldCallLLM('Green', 25), false);
  assert.equal(shouldCallLLM('Green', 99), false);
});

test('shouldCallLLM returns true for Amber regardless of score', () => {
  assert.equal(shouldCallLLM('Amber', 0), true);
  assert.equal(shouldCallLLM('Amber', 11), true);
  assert.equal(shouldCallLLM('Amber', -5), true);
});

test('shouldCallLLM returns true for borderline Red (score > -10)', () => {
  assert.equal(shouldCallLLM('Red', -9), true);
  assert.equal(shouldCallLLM('Red', -1), true);
  assert.equal(shouldCallLLM('Red', 0), true);
});

test('shouldCallLLM returns true for borderline Green (score < 18)', () => {
  assert.equal(shouldCallLLM('Green', 17), true);
  assert.equal(shouldCallLLM('Green', 12), true);
  assert.equal(shouldCallLLM('Green', 0), true);
});

// ---- Circuit breaker behaviour -------------------------------------------

test('circuit breaker opens after threshold consecutive failures', async () => {
  assert.equal(isLLMCircuitOpen(), false);

  const threshold = 3;
  for (let i = 0; i < threshold; i += 1) {
    const result = await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });
    assert.equal(result.ok, false, `call ${i + 1} should fail`);
    assert.ok(['http', 'timeout', 'parse'].includes(result.error), `call ${i + 1} returns known error code`);
  }

  assert.equal(isLLMCircuitOpen(), true);
  assert.equal(requestCount, threshold, 'each pre-open call must hit the stub');
});

test('open breaker returns early without making HTTP calls', async () => {
  // Trip the breaker first.
  for (let i = 0; i < 3; i += 1) {
    await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });
  }
  assert.equal(isLLMCircuitOpen(), true);
  const beforeRequests = requestCount;

  const result = await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'circuit_open');
  assert.equal(result.latencyMs, 0);
  assert.equal(requestCount, beforeRequests, 'no HTTP call once breaker is open');
});

test('resetLLMCircuitBreaker clears state and allows calls again', async () => {
  for (let i = 0; i < 3; i += 1) {
    await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });
  }
  assert.equal(isLLMCircuitOpen(), true);

  resetLLMCircuitBreaker();
  assert.equal(isLLMCircuitOpen(), false);

  // Stub is still in http500 mode, so the next call fails again — proving
  // the breaker is closed and the function actually ran.
  nextBehavior = 'ok';
  const okResult = await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.rating, 'Green');
});

test('parse failures also count toward the circuit breaker', async () => {
  // The stub returns 200 with a non-JSON string in the response field →
  // axios succeeds but parseAndValidate returns null → counts as a parse failure.
  nextBehavior = 'garbage';
  for (let i = 0; i < 3; i += 1) {
    const result = await analyzeJobWithLLM(fakeJob(), { regexRating: 'Amber', regexScore: 8 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'parse');
  }
  assert.equal(isLLMCircuitOpen(), true);
});
