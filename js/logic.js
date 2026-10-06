/*
 * Happy Sort — game rules, solver and level generator. No DOM; also loaded by the Node tests.
 *
 * A bottle is an array of layers, bottom first: { c: colourIndex, hidden: bool }.
 * You may pour from A to B when B has room and is empty or its top colour
 * matches A's top colour. All contiguous same-colour layers on top of A move
 * across, as many as fit. A level is solved when every bottle is empty or
 * full of a single colour.
 */
(function (root) {
  'use strict';

  const CAPACITY = 4;

  const COLORS = [
    '#ff8fd6', // pink
    '#3b4bff', // blue
    '#ffd23f', // yellow
    '#8a4428', // brown
    '#94d82d', // green
    '#ff7a1f', // orange
    '#8f3fe0', // purple
    '#40b8ff', // light blue
    '#a3a6f5', // lavender
    '#ff3b4e', // red
    '#20d6a8', // teal
    '#f2f2f2', // white
  ];

  function clone(bottles) {
    return bottles.map(b => b.map(l => ({ c: l.c, hidden: l.hidden })));
  }

  function topRun(bottle) {
    if (!bottle.length) return 0;
    const top = bottle[bottle.length - 1];
    let n = 0;
    for (let i = bottle.length - 1; i >= 0; i--) {
      const l = bottle[i];
      if (l.hidden || l.c !== top.c) break;
      n++;
    }
    return n;
  }

  function isComplete(bottle) {
    return bottle.length === CAPACITY && bottle.every(l => !l.hidden && l.c === bottle[0].c);
  }

  function isSolved(bottles) {
    return bottles.every(b => b.length === 0 || isComplete(b));
  }

  function canPour(bottles, from, to) {
    if (from === to) return false;
    const a = bottles[from], b = bottles[to];
    if (!a.length || b.length >= CAPACITY) return false;
    if (!b.length) return !isComplete(a); // pointless to move a finished bottle
    return b[b.length - 1].c === a[a.length - 1].c;
  }

  /** Mutates bottles. Returns number of layers moved. */
  function pour(bottles, from, to) {
    if (!canPour(bottles, from, to)) return 0;
    const a = bottles[from], b = bottles[to];
    const n = Math.min(topRun(a), CAPACITY - b.length);
    for (let i = 0; i < n; i++) b.push(a.pop());
    if (a.length) a[a.length - 1].hidden = false;
    return n;
  }

  // ---------- Solver (guarantees generated and shuffled levels are solvable) ----------

  function solvable(colorsGrid, maxNodes = 150000) {
    // colorsGrid: arrays of colour indices, bottom first, full knowledge.
    const key = s => s.map(b => b.join(',')).sort().join('|');
    const seen = new Set();
    let nodes = 0;
    const done = s => s.every(b => b.length === 0 || (b.length === CAPACITY && b.every(c => c === b[0])));

    function dfs(s) {
      if (done(s)) return true;
      if (++nodes > maxNodes) return false;
      const k = key(s);
      if (seen.has(k)) return false;
      seen.add(k);
      for (let i = 0; i < s.length; i++) {
        const a = s[i];
        if (!a.length) continue;
        const top = a[a.length - 1];
        let run = 0;
        for (let x = a.length - 1; x >= 0 && a[x] === top; x--) run++;
        const uniform = run === a.length;
        let triedEmpty = false;
        for (let j = 0; j < s.length; j++) {
          if (i === j) continue;
          const b = s[j];
          if (b.length >= CAPACITY) continue;
          if (b.length) {
            if (b[b.length - 1] !== top) continue;
          } else {
            if (uniform || triedEmpty) continue; // symmetric / useless moves
            triedEmpty = true;
          }
          const n = Math.min(run, CAPACITY - b.length);
          const next = s.map(x => x.slice());
          for (let t = 0; t < n; t++) next[j].push(next[i].pop());
          if (dfs(next)) return true;
        }
      }
      return false;
    }
    return dfs(colorsGrid.map(b => b.slice()));
  }

  // ---------- Level generation ----------

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function levelConfig(level) {
    const colors = Math.min(3 + Math.floor((level - 1) / 3), COLORS.length);
    return {
      colors,
      empties: 2,
      // Mystery layers appear from level 6 and get more common.
      hiddenChance: level < 6 ? 0 : Math.min(0.25 + (level - 6) * 0.03, 0.8),
    };
  }

  function topRunOf(arr) {
    let n = 0;
    for (let i = arr.length - 1; i >= 0 && arr[i] === arr[arr.length - 1]; i--) n++;
    return n;
  }

  function shuffleArray(a, rand) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function generateLevel(level) {
    const cfg = levelConfig(level);
    const rand = rng(level * 7919 + 17);
    for (let attempt = 0; attempt < 200; attempt++) {
      const units = [];
      for (let c = 0; c < cfg.colors; c++) for (let k = 0; k < CAPACITY; k++) units.push(c);
      shuffleArray(units, rand);
      const grid = [];
      for (let b = 0; b < cfg.colors; b++) grid.push(units.slice(b * CAPACITY, (b + 1) * CAPACITY));
      for (let e = 0; e < cfg.empties; e++) grid.push([]);

      // Reject trivial starts: 3 or more of a kind stacked on top.
      const tooEasy = grid.some(b => b.length && topRunOf(b) >= 3);
      if (tooEasy || !solvable(grid)) continue;

      const hideBottle = grid.map(() => rand() < cfg.hiddenChance);
      return grid.map((b, bi) =>
        b.map((c, i) => ({ c, hidden: hideBottle[bi] && i < b.length - 1 })));
    }
    throw new Error('Could not generate level ' + level);
  }

  /**
   * Shuffle power-up: re-deals the colours of every unfinished bottle (each bottle keeps its fill
   * height and hidden slots), keeping the board solvable. Mutates bottles; returns true on success.
   */
  function shuffle(bottles, rand = Math.random) {
    const idx = bottles.map((b, i) => i).filter(i => bottles[i].length && !isComplete(bottles[i]));
    const pool = [];
    idx.forEach(i => bottles[i].forEach(l => pool.push(l.c)));
    if (pool.length < 2) return false;
    const before = idx.map(i => bottles[i].map(l => l.c).join()).join('|');
    for (let attempt = 0; attempt < 200; attempt++) {
      shuffleArray(pool, rand);
      const grid = bottles.map(b => b.map(l => l.c));
      let k = 0;
      idx.forEach(i => { grid[i] = grid[i].map(() => pool[k++]); });
      if (idx.map(i => grid[i].join()).join('|') === before) continue;
      if (!solvable(grid)) continue;
      idx.forEach(i => bottles[i].forEach((l, li) => { l.c = grid[i][li]; }));
      return true;
    }
    return false;
  }

  const Logic = { CAPACITY, COLORS, clone, topRun, canPour, pour, isComplete, isSolved,
    solvable, generateLevel, levelConfig, shuffle, rng };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  else root.Logic = Logic;
})(typeof window !== 'undefined' ? window : globalThis);
