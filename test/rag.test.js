import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../src/utils/rag.js';

test('scoreJob returns matches with title and domain labels', () => {
  const out = scoreJob({
    title: 'Senior BIM Manager',
    description: 'Lead digital delivery on a major infrastructure programme. ISO 19650 and BIM execution planning.',
  });
  assert.ok(out.matches);
  assert.ok(Array.isArray(out.matches.title));
  assert.ok(out.matches.title.some((t) => /manager|lead|senior/i.test(t)));
  assert.ok(out.matches.domain.some((t) => /BIM|ISO 19650|Digital Delivery|Infrastructure/i.test(t)));
});

test('scoreJob returns empty match buckets for non-AEC blocker titles', () => {
  const out = scoreJob({
    title: 'Registered Nurse — NHS',
    description: 'Patient care and ward duties.',
  });
  assert.equal(out.rating, 'Red');
  assert.deepEqual(out.matches.title, []);
  assert.deepEqual(out.matches.domain, []);
  assert.deepEqual(out.matches.experience, []);
});
