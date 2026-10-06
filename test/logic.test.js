const assert = require('assert');
const L = require('../game.js');

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
