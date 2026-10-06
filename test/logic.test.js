const assert = require('assert');
const L = require('../js/logic.js');

const mk = arr => arr.map(b => b.map(c => ({ c, hidden: false })));

// Basic pour rules
let s = mk([[0, 1, 1], [1], []]);
assert.ok(L.canPour(s, 0, 1));
assert.strictEqual(L.pour(s, 0, 1), 2);          // both 1s move
assert.deepStrictEqual(s[1].map(l => l.c), [1, 1, 1]);
assert.ok(!L.canPour(s, 0, 1));                   // 0 onto 1: mismatch
assert.ok(L.canPour(s, 0, 2));                    // anything into empty

// Capacity limits the amount poured
s = mk([[2, 2, 2], [0, 0, 2], []]);
assert.strictEqual(L.pour(s, 0, 1), 1);

// Hidden layers are revealed when they become the top
s = [[{ c: 3, hidden: true }, { c: 1, hidden: false }], []];
L.pour(s, 0, 1);
assert.strictEqual(s[0][0].hidden, false);

// Win detection
assert.ok(L.isSolved(mk([[1, 1, 1, 1], [], [0, 0, 0, 0]])));
assert.ok(!L.isSolved(mk([[1, 1, 1], [1]])));

// Every generated level for 1..60 is solvable and well-formed
for (let lvl = 1; lvl <= 60; lvl++) {
  const b = L.generateLevel(lvl);
  const grid = b.map(x => x.map(l => l.c));
  const counts = {};
  grid.flat().forEach(c => counts[c] = (counts[c] || 0) + 1);
  assert.ok(Object.values(counts).every(n => n === L.CAPACITY), 'counts lvl ' + lvl);
  assert.ok(L.solvable(grid, 1e6), 'solvable lvl ' + lvl);
  assert.ok(b.every(x => !x.length || !x[x.length - 1].hidden), 'top visible lvl ' + lvl);
}
console.log('all tests passed');

// Shuffle keeps colour counts, fill heights and finished bottles, and stays solvable
for (let lvl = 1; lvl <= 20; lvl++) {
  const b = L.generateLevel(lvl);
  L.pour(b, 0, b.length - 1);
  const heights = b.map(x => x.length);
  const count = g => { const m = {}; g.flat().forEach(l => m[l.c] = (m[l.c] || 0) + 1); return JSON.stringify(Object.entries(m).sort()); };
  const before = count(b);
  assert.ok(L.shuffle(b, L.rng(lvl)), 'shuffle lvl ' + lvl);
  assert.deepStrictEqual(b.map(x => x.length), heights);
  assert.strictEqual(count(b), before);
  assert.ok(L.solvable(b.map(x => x.map(l => l.c)), 1e6));
}
console.log('shuffle tests passed');
