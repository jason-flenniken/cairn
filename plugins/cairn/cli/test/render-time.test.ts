import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timingText } from '../src/render.ts';

const at = (ms: number) => timingText({ discover: ms });

test('stage times round to whole minutes without showing 60m', () => {
  assert.equal(at(3_599_000), 'Discover 1h 0m');
  assert.equal(at(10_785_000), 'Discover 3h 0m');
  assert.equal(at(1_799_000), 'Discover 30m');
  assert.equal(at(30_000), 'Discover <1m');
  assert.equal(at(5_400_000), 'Discover 1h 30m');
});
