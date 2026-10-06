/*
 * Happy Sort — a colour-sorting puzzle.
 *
 * A bottle is an array of layers, bottom first: { c: colourIndex, hidden: bool }.
 * You may pour from A to B when B has room and is empty or its top colour
 * matches A's top colour. All contiguous same-colour layers on top of A move
 * across, as many as fit. A level is solved when every bottle is empty or
 * full of a single colour.
 */
(function () {
  'use strict';

  const CAPACITY = 4;

  const COLORS = [
    '#f48fd0', // pink
    '#2f3ee0', // blue
    '#f7c531', // yellow
    '#7a3a26', // brown
    '#8bc62a', // green
    '#e8691f', // orange
    '#6a2fa8', // purple
    '#3fa6e6', // light blue
    '#8d8fd6', // lavender
    '#e23b3b', // red
    '#1fb89a', // teal
    '#eeeeee', // white
  ];

  // ---------- Pure game logic ----------

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

  function isComplete(bottle) {
    return bottle.length === CAPACITY && bottle.every(l => !l.hidden && l.c === bottle[0].c);
  }

  function isSolved(bottles) {
    return bottles.every(b => b.length === 0 || isComplete(b));
  }

  // ---------- Solver (used to guarantee generated levels are solvable) ----------

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

  function generateLevel(level) {
    const cfg = levelConfig(level);
    const rand = rng(level * 7919 + 17);
    for (let attempt = 0; attempt < 200; attempt++) {
      const units = [];
      for (let c = 0; c < cfg.colors; c++) for (let k = 0; k < CAPACITY; k++) units.push(c);
      for (let i = units.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [units[i], units[j]] = [units[j], units[i]];
      }
      const grid = [];
      for (let b = 0; b < cfg.colors; b++) grid.push(units.slice(b * CAPACITY, (b + 1) * CAPACITY));
      for (let e = 0; e < cfg.empties; e++) grid.push([]);

      // Reject trivial starts: a bottle already sorted or 3-of-a-kind stacks.
      const tooEasy = grid.some(b => b.length && topRunOf(b) >= 3);
      if (tooEasy || !solvable(grid)) continue;

      const hideBottle = grid.map(() => rand() < cfg.hiddenChance);
      return grid.map((b, bi) =>
        b.map((c, i) => ({ c, hidden: hideBottle[bi] && i < b.length - 1 })));
    }
    throw new Error('Could not generate level ' + level);
  }

  function topRunOf(arr) {
    let n = 0;
    for (let i = arr.length - 1; i >= 0 && arr[i] === arr[arr.length - 1]; i--) n++;
    return n;
  }

  const Logic = { CAPACITY, COLORS, clone, topRun, canPour, pour, isComplete, isSolved,
    solvable, generateLevel, levelConfig };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logic;
    return;
  }

  // ---------- UI ----------

  const store = {
    get(k, d) { try { const v = localStorage.getItem('happy-sort:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('happy-sort:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const $ = id => document.getElementById(id);
  const board = $('board');

  const state = {
    level: store.get('level', 1),
    coins: store.get('coins', 0),
    bottles: [],
    history: [],
    selected: null,
    busy: false,
    undosLeft: 0,
    addsLeft: 0,
  };

  function startLevel(level) {
    state.level = level;
    state.bottles = generateLevel(level);
    state.history = [];
    state.selected = null;
    state.undosLeft = 5;
    state.addsLeft = 1;
    store.set('level', level);
    $('win').classList.add('hidden');
    buildBoard();
    render();
  }

  function buildBoard() {
    board.innerHTML = '';
    state.bottles.forEach((_, i) => {
      const el = document.createElement('div');
      el.className = 'bottle';
      el.dataset.index = i;
      el.innerHTML = '<div class="neck"></div><div class="glass"></div>';
      el.addEventListener('click', () => onBottleTap(i));
      board.appendChild(el);
    });
  }

  function render() {
    const els = board.children;
    state.bottles.forEach((bottle, i) => {
      const el = els[i];
      const glass = el.querySelector('.glass');
      glass.innerHTML = '';
      bottle.forEach((layer, li) => {
        const d = document.createElement('div');
        d.className = 'layer';
        if (layer.hidden) d.classList.add('hidden-layer');
        else d.style.backgroundColor = COLORS[layer.c];
        if (li === bottle.length - 1 && !layer.hidden) d.classList.add('top-surface');
        glass.appendChild(d);
      });
      el.classList.toggle('selected', state.selected === i);
      el.classList.toggle('complete', isComplete(bottle));
    });
    $('level').textContent = state.level;
    $('coins').textContent = state.coins;
    $('undo-count').textContent = state.undosLeft;
    $('add-count').textContent = state.addsLeft;
    $('undo').disabled = !state.history.length || !state.undosLeft;
    $('add-bottle').disabled = !state.addsLeft;
  }

  function onBottleTap(i) {
    if (state.busy) return;
    if (state.selected === null) {
      if (!state.bottles[i].length || isComplete(state.bottles[i])) return;
      state.selected = i;
      render();
      return;
    }
    const from = state.selected;
    state.selected = null;
    if (from === i) { render(); return; }
    if (!canPour(state.bottles, from, i)) {
      render();
      shake(board.children[i]);
      return;
    }
    animatePour(from, i);
  }

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function animatePour(from, to) {
    state.busy = true;
    const src = board.children[from];
    const dst = board.children[to];
    const sr = src.getBoundingClientRect();
    const dr = dst.getBoundingClientRect();
    const dir = dr.left >= sr.left ? 1 : -1; // tilt toward the target
    const dx = dr.left - sr.left - dir * sr.width * 0.55;
    const dy = dr.top - sr.top - sr.height * 0.45;
    const tilt = dir * 75;

    src.style.zIndex = 5;
    src.classList.remove('selected');
    const out = src.animate([
      { transform: 'translate(0, -22px) rotate(0deg)' },
      { transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg)` },
    ], { duration: 280, easing: 'ease-in-out', fill: 'forwards' });

    out.onfinish = () => {
      state.history.push(clone(state.bottles));
      pour(state.bottles, from, to);
      render();
      setTimeout(() => {
        const back = src.animate([
          { transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg)` },
          { transform: 'translate(0, 0) rotate(0deg)' },
        ], { duration: 260, easing: 'ease-in-out' });
        out.cancel();
        back.onfinish = () => {
          src.style.zIndex = '';
          state.busy = false;
          if (isSolved(state.bottles)) onWin();
        };
      }, 220);
    };
  }

  function onWin() {
    const reward = 10 + Math.floor(state.level / 5) * 5;
    state.coins += reward;
    store.set('coins', state.coins);
    store.set('level', state.level + 1);
    $('win-reward').textContent = `+${reward} coins`;
    $('win').classList.remove('hidden');
    render();
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 1600);
  }

  $('undo').addEventListener('click', () => {
    if (state.busy || !state.history.length || !state.undosLeft) return;
    state.bottles = state.history.pop();
    state.undosLeft--;
    state.selected = null;
    if (board.children.length !== state.bottles.length) buildBoard();
    render();
  });

  $('add-bottle').addEventListener('click', () => {
    if (state.busy || !state.addsLeft) return;
    state.history.push(clone(state.bottles));
    state.bottles.push([]);
    state.addsLeft--;
    buildBoard();
    render();
    toast('Extra bottle added');
  });

  $('restart').addEventListener('click', () => { if (!state.busy) startLevel(state.level); });
  $('next').addEventListener('click', () => startLevel(state.level + 1));

  startLevel(state.level);
})();
