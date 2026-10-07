'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArray, bubbleSortSteps } = require('../script.js');

const sorted = (values) => [...values].sort((a, b) => a - b);

// Validate the public animation contract while independently replaying each step.
function verifyTrace(input) {
  const original = [...input];
  const expected = sorted(input);
  const steps = [...bubbleSortSteps(input)];
  assert.deepEqual(input, original, 'the caller\'s array must not be modified');
  assert.ok(steps.length > 0, 'a trace must contain a completion event');

  let current = [...original];
  let comparisons = 0;
  let swaps = 0;
  let pendingComparison = null;
  let previousSortedFrom = input.length;
  let previousRound = 0;
  const allowedTypes = new Set(['compare', 'swap', 'keep', 'pass-end', 'done']);

  steps.forEach((step, position) => {
    assert.ok(allowedTypes.has(step.type), `unknown event: ${step.type}`);
    assert.ok(Array.isArray(step.values));
    assert.ok(Array.isArray(step.indices));
    assert.equal(step.values.length, input.length);
    assert.deepEqual(sorted(step.values), expected, 'events must preserve all elements');
    assert.equal(typeof step.message, 'string');
    assert.ok(step.message.trim().length > 0, 'events need explanatory text');
    assert.ok(Number.isInteger(step.sortedFrom));
    assert.ok(step.sortedFrom >= 0 && step.sortedFrom <= input.length);
    assert.ok(step.sortedFrom <= previousSortedFrom, 'sorted suffix cannot shrink');
    assert.deepEqual(step.values.slice(step.sortedFrom), expected.slice(step.sortedFrom));
    assert.ok(Number.isInteger(step.round));
    assert.ok(step.round >= previousRound, 'round numbers cannot go backwards');

    if (pendingComparison) {
      assert.ok(step.type === 'swap' || step.type === 'keep',
        'each comparison must immediately yield swap or keep');
      assert.deepEqual(step.indices, pendingComparison.indices);
      assert.equal(step.round, pendingComparison.round);
    }

    if (step.type === 'compare') {
      assert.equal(pendingComparison, null);
      assert.equal(step.indices.length, 2);
      const [left, right] = step.indices;
      assert.ok(Number.isInteger(left) && Number.isInteger(right));
      assert.ok(left >= 0 && right < input.length);
      assert.equal(right, left + 1, 'bubble sort compares adjacent elements');
      assert.ok(right < previousSortedFrom, 'do not compare the sorted suffix');
      comparisons += 1;
      pendingComparison = { indices: [...step.indices], round: step.round };
    } else if (step.type === 'swap' || step.type === 'keep') {
      assert.ok(pendingComparison, 'a decision must follow a comparison');
      const [left, right] = step.indices;
      if (step.type === 'swap') {
        assert.ok(current[left] > current[right], 'swap only an out-of-order pair');
        [current[left], current[right]] = [current[right], current[left]];
        swaps += 1;
      } else {
        assert.ok(current[left] <= current[right], 'keep only an ordered pair');
      }
      pendingComparison = null;
    } else if (step.type === 'pass-end') {
      assert.ok(step.sortedFrom < previousSortedFrom,
        'a completed pass must grow the sorted suffix');
    } else if (step.type === 'done') {
      assert.equal(position, steps.length - 1, 'done must be the final event');
      assert.equal(step.sortedFrom, 0);
      assert.deepEqual(step.values, expected);
    }

    assert.deepEqual(step.values, current, 'only a swap event may change values');
    assert.equal(step.comparisons, comparisons, 'comparison count must match events');
    assert.equal(step.swaps, swaps, 'swap count must match events');
    previousSortedFrom = step.sortedFrom;
    previousRound = step.round;
  });

  assert.equal(pendingComparison, null);
  assert.equal(steps.at(-1).type, 'done');
  return steps;
}

test('parseArray accepts English commas, Chinese commas and whitespace', () => {
  assert.deepEqual(parseArray(' 64,34，25 12\t22\n11,90 '), [64, 34, 25, 12, 22, 11, 90]);
  assert.deepEqual(parseArray('1，100'), [1, 100]);
});

test('parseArray accepts exactly twenty integers', () => {
  assert.deepEqual(parseArray('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20'),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

for (const input of [
  '', '   \t\n', ',， ,', '7',
  '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21',
  '1,2.5', '1,2.0', '1,1e2', '1,2E1', '1,hello', '1,NaN', '1,Infinity',
  '1,0x10', '1,2/3', '1,二', '0,2', '-1,2', '1,101',
]) {
  test(`parseArray rejects ${JSON.stringify(input)} with a Chinese error`, () => {
    assert.throws(() => parseArray(input), (error) =>
      error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message));
  });
}

const fixtures = [
  ['default array', [5, 3, 8, 2, 6], [2, 3, 5, 6, 8]],
  ['longer teaching example', [64, 34, 25, 12, 22, 11, 90], [11, 12, 22, 25, 34, 64, 90]],
  ['ascending', [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]],
  ['descending', [5, 4, 3, 2, 1], [1, 2, 3, 4, 5]],
  ['duplicates', [4, 2, 4, 1, 2], [1, 2, 2, 4, 4]],
  ['all equal', [7, 7, 7, 7], [7, 7, 7, 7]],
  ['two elements', [100, 1], [1, 100]],
  ['twenty elements', [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
];

for (const [name, input, expected] of fixtures) {
  test(`bubbleSortSteps correctly sorts ${name} and emits a valid trace`, () => {
    const steps = verifyTrace(input);
    assert.deepEqual(steps.at(-1).values, expected);
  });
}

test('an ordered array exits after one pass without swaps', () => {
  const steps = verifyTrace([1, 2, 3, 4, 5]);
  assert.equal(steps.at(-1).comparisons, 4);
  assert.equal(steps.at(-1).swaps, 0);
  assert.equal(steps.filter((step) => step.type === 'pass-end').length, 1);
});

test('equal values never swap and exit after one pass', () => {
  const steps = verifyTrace([8, 8, 8, 8]);
  assert.equal(steps.at(-1).comparisons, 3);
  assert.equal(steps.at(-1).swaps, 0);
  assert.equal(steps.filter((step) => step.type === 'pass-end').length, 1);
});

test('a later pass with no swaps stops the remaining passes', () => {
  const steps = verifyTrace([2, 1, 3, 4, 5]);
  assert.equal(steps.at(-1).comparisons, 7);
  assert.equal(steps.at(-1).swaps, 1);
  assert.equal(steps.filter((step) => step.type === 'pass-end').length, 2);
});

test('reverse order uses exactly the required adjacent comparisons and swaps', () => {
  const steps = verifyTrace([5, 4, 3, 2, 1]);
  assert.equal(steps.at(-1).comparisons, 10);
  assert.equal(steps.at(-1).swaps, 10);
  assert.deepEqual(steps.filter((step) => step.type === 'pass-end').map((step) => step.sortedFrom),
    [4, 3, 2, 1]);
});

test('two reversed elements yield compare, swap, pass-end and done', () => {
  const steps = verifyTrace([2, 1]);
  assert.deepEqual(steps.map((step) => step.type), ['compare', 'swap', 'pass-end', 'done']);
  assert.equal(steps.at(-1).comparisons, 1);
  assert.equal(steps.at(-1).swaps, 1);
});

test('emitted value snapshots stay unchanged as the generator advances', () => {
  const iterator = bubbleSortSteps([3, 2, 1]);
  const first = iterator.next().value;
  const snapshot = [...first.values];
  Array.from(iterator);
  assert.deepEqual(first.values, snapshot);
  assert.deepEqual(first.values, [3, 2, 1]);
});

test('deterministic generated inputs preserve invariants for every permitted length', () => {
  let seed = 20261007;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let length = 2; length <= 20; length += 1) {
    for (let sample = 0; sample < 5; sample += 1) {
      const input = Array.from({ length }, () => 1 + (next() % 100));
      const steps = verifyTrace(input);
      assert.ok(steps.at(-1).comparisons <= length * (length - 1) / 2);
    }
  }
});
