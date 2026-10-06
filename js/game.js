// Happy Sort — game screen: state, input, animations and effects. Rules live in logic.js,
// drawing in render.js, sound and haptics in fx.js.
//
// The rules state (state.bottles) changes the moment a pour is tapped. What you see is a separate
// display model (display[i] = layers with fractional volumes) that pours animate toward the rules
// state. That is what lets several pours run at the same time: each pour waits only for earlier
// pours that share one of its bottles, then moves its liquid frame by frame.
(() => {
  'use strict';
  const L = window.Logic;
  const $ = id => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('happy-sort:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('happy-sort:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // Timings (ms).
  const MOVE = 260, RETURN = 280, PER_UNIT = 230, POUR_EXTRA = 140;

  const state = {
    level: store.get('level', 1),
    coins: store.get('coins', 0),
    bottles: [],
    history: [],
    selected: null,
    undos: 0, shuffles: 0, adds: 0,
    won: false,
  };

  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let geom = null, slots = [];
  let lift = [];
  let display = [];
  let pours = [];
  let pourId = 0;
  const corks = new Map();   // bottle → time its cork started to drop
  const shakes = new Map();  // bottle → start time
  const wobbles = new Map(); // bottle → { t0, amp }
  const born = new Map();    // bottle → time it appeared
  let particles = [];
  let stars = [];

  // ---------- Display model ----------
  const layerOf = l => ({ c: l.c, color: L.COLORS[l.c], vol: 1, hidden: l.hidden, revealAt: null });
  function syncDisplay() {
    display = state.bottles.map((b, i) => b.map((l, li) => {
      const d = layerOf(l);
      const old = display[i] && display[i][li];
      if (old && old.c === l.c && old.revealAt) d.revealAt = old.revealAt;
      return d;
    }));
  }
  const unitsIn = i => display[i].reduce((n, l) => n + l.vol, 0);

  function transfer(from, to, amount, c) {
    let left = amount;
    const src = display[from];
    while (left > 1e-9 && src.length) {
      const top = src[src.length - 1];
      const take = Math.min(top.vol, left);
      top.vol -= take; left -= take;
      if (top.vol <= 1e-6) src.pop();
    }
    const dst = display[to];
    const top = dst[dst.length - 1];
    if (top && top.c === c && !top.hidden && top.vol < 1 - 1e-6) top.vol += amount;
    else dst.push({ c, color: L.COLORS[c], vol: amount, hidden: false, revealAt: null });
  }

  // ---------- Levels ----------
  function startLevel(level) {
    state.level = level;
    state.bottles = L.generateLevel(level);
    state.history = [];
    state.selected = null;
    state.undos = 5; state.shuffles = 1; state.adds = 1;
    state.won = false;
    pours = []; corks.clear(); shakes.clear(); wobbles.clear(); born.clear();
    particles = particles.filter(p => p.kind === 'confetti');
    display = [];
    syncDisplay();
    store.set('level', level);
    $('win').classList.add('hidden');
    layout();
    lift = state.bottles.map(() => 0);
    const now = performance.now();
    state.bottles.forEach((_, i) => born.set(i, now + i * 40));
    updateUI();
  }

  // ---------- Layout ----------
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const top = $('level-badge').getBoundingClientRect().bottom + 16;
    const bottom = $('toolbar').getBoundingClientRect().top - 16;
    const n = state.bottles.length;
    const rows = Math.max(1, Math.ceil(n / 5));
    const perRow = Math.ceil(n / rows);
    const availW = Math.min(W, 560) - 24;
    const availH = bottom - top;
    const RATIO = 2.75;
    let w = Math.min((availW / perRow) * 0.7, 80);
    let h = w * RATIO;
    const need = rows * h * 1.14 + (rows - 1) * h * 0.22;
    if (need > availH) { const k = availH / need; w *= k; h *= k; }
    geom = Render.makeGeom(w, h);
    const room = h * 0.14, gy = h * 0.22;
    const total = rows * (h + room) + (rows - 1) * gy;
    let y = top + (availH - total) / 2 + room;
    slots = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const count = Math.min(perRow, n - i);
      const gapX = Math.min(availW / perRow, w * 1.7);
      const x0 = W / 2 - ((count - 1) * gapX) / 2;
      for (let c = 0; c < count; c++, i++) slots.push({ x: x0 + c * gapX, top: y });
      y += h + room + gy;
    }
    const count = Math.round((W * H) / 11000);
    const rand = L.rng(42);
    stars = Array.from({ length: count }, () => ({ x: rand() * W, y: rand() * H, r: 0.4 + rand() * 1.1, ph: rand() * 6.28, sp: 0.3 + rand() * 0.9 }));
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', e => {
    if (state.won) return;
    const i = hit(e.clientX, e.clientY);
    if (i < 0) {
      if (state.selected != null) { state.selected = null; Fx.play('deselect'); }
      return;
    }
    onBottleTap(i);
  });

  function hit(x, y) {
    if (!geom) return -1;
    let best = -1, bestD = Infinity;
    slots.forEach((s, i) => {
      const inX = Math.abs(x - s.x) <= geom.w * 0.8;
      const inY = y >= s.top - geom.h * 0.25 && y <= s.top + geom.h + 14;
      if (inX && inY) { const d = Math.abs(x - s.x); if (d < bestD) { bestD = d; best = i; } }
    });
    return best;
  }

  const flying = i => pours.some(p => p.from === i && p.phase !== 'wait');

  function onBottleTap(i) {
    if (flying(i)) return;
    const b = state.bottles[i];
    if (state.selected == null) {
      if (!b.length || L.isComplete(b)) { nope(i); return; }
      state.selected = i;
      wobbles.set(i, { t0: performance.now(), amp: 0.05 });
      Fx.play('select'); Fx.buzz('light');
      return;
    }
    const from = state.selected;
    state.selected = null;
    if (from === i) { Fx.play('deselect'); return; }
    if (!L.canPour(state.bottles, from, i)) { nope(i); return; }
    queuePour(from, i);
  }

  function nope(i) {
    shakes.set(i, performance.now());
    Fx.play('nope');
  }

  // ---------- Pours ----------
  function queuePour(from, to) {
    const src = state.bottles[from];
    const n = Math.min(L.topRun(src), L.CAPACITY - state.bottles[to].length);
    const c = src[src.length - 1].c;
    state.history.push(L.clone(state.bottles));
    L.pour(state.bottles, from, to);
    pours.push({ id: ++pourId, from, to, n, c, color: L.COLORS[c], phase: 'wait', t0: 0, moved: 0, pourDur: n * PER_UNIT + POUR_EXTRA, startLift: lift[from] || 0 });
    updateUI();
  }

  // A pour may start once every earlier pour sharing one of its bottles is out of the way: a bottle
  // that is still pouring out (or flying back) can't take part, and a bottle still being filled
  // can't pour out until that liquid has arrived. Two bottles may fill the same bottle at once
  // (the rules guarantee it's the same colour); they pour from opposite sides.
  function canStart(p) {
    for (const e of pours) {
      if (e === p) return true;
      if (e.from === p.from || e.from === p.to) return false;
      if (e.to === p.from && e.phase !== 'return') return false;
    }
    return true;
  }

  function begin(p, now) {
    p.phase = 'move';
    p.t0 = now;
    const sx = slots[p.from].x, tx = slots[p.to].x;
    let dir = Math.abs(tx - sx) > 4 ? Math.sign(tx - sx) : (tx >= W / 2 ? 1 : -1);
    // Someone already pouring into this bottle from that side? Use the other side.
    if (pours.some(e => e !== p && e.to === p.to && (e.phase === 'move' || e.phase === 'pour') && e.dir === dir)) dir = -dir;
    // The tilted bottle lies on the side away from its lip; keep it on screen.
    const reach = geom.h * 0.85;
    if (dir > 0 && tx - reach < 0) dir = -1;
    else if (dir < 0 && tx + reach > W) dir = 1;
    p.dir = dir;
  }

  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  function poseForAngle(a, p) {
    const t = slots[p.to];
    const P = { x: t.x - p.dir * geom.w * 0.12, y: t.top - geom.h * 0.17 };
    const lx = p.dir * geom.lipX;
    return { x: P.x - lx * Math.cos(a), y: P.y - lx * Math.sin(a), a };
  }

  // Advances one pour; returns what to draw for it.
  function step(p, now) {
    if (p.phase === 'wait') {
      if (!canStart(p)) return null;
      begin(p, now);
    }
    const t = now - p.t0;
    const home = { x: slots[p.from].x, y: slots[p.from].top - p.startLift, a: 0 };
    let pose, stream = null;
    if (p.phase === 'move' && t >= MOVE) {
      p.phase = 'pour';
      Fx.play('pour', p.pourDur, unitsIn(p.to), unitsIn(p.to) + p.n);
      Fx.buzz('light');
    }
    if (p.phase === 'pour' && t >= MOVE + p.pourDur) endPour(p, now);
    if (p.phase === 'move') {
      const k = ease(t / MOVE);
      const target = poseForAngle(Render.pourAngle(geom, unitsIn(p.from), p.dir), p);
      pose = { x: lerp(home.x, target.x, k), y: lerp(home.y, target.y, k), a: lerp(0, target.a, k) };
    } else if (p.phase === 'pour') {
      const pp = (t - MOVE) / p.pourDur;
      const goal = p.n * ease(pp);
      transfer(p.from, p.to, goal - p.moved, p.c);
      p.moved = goal;
      pose = poseForAngle(Render.pourAngle(geom, unitsIn(p.from), p.dir), p);
      const env = Math.max(0, Math.min(1, pp * 7, (1 - pp) * 5));
      const lp = Render.lip(geom, pose, p.dir);
      const tPose = { x: slots[p.to].x, y: slots[p.to].top, a: 0 };
      const filled = unitsIn(p.to) * geom.unit;
      const ty = filled > 0 ? Render.surface(Render.toWorld(geom.inner, tPose), filled) : slots[p.to].top + geom.h - geom.t;
      const landX = slots[p.to].x - p.dir * geom.w * 0.06;
      stream = { from: lp, to: { x: landX, y: ty }, width: geom.nw * 0.34 * env, color: p.color };
      if (Math.random() < 0.5) splash(landX, ty, p.color);
    } else {
      const k = ease(Math.min(1, (t - MOVE - p.pourDur) / RETURN));
      const rest = { x: slots[p.from].x, y: slots[p.from].top, a: 0 };
      pose = { x: lerp(p.endPose.x, rest.x, k), y: lerp(p.endPose.y, rest.y, k), a: lerp(p.endPose.a, 0, k) };
    }
    return { pose, stream };
  }

  function endPour(p, now) {
    transfer(p.from, p.to, p.n - p.moved, p.c);
    p.moved = p.n;
    p.phase = 'return';
    p.endPose = poseForAngle(Render.pourAngle(geom, unitsIn(p.from), p.dir), p);
    wobbles.set(p.to, { t0: now, amp: 0.1 });
    // The new top of the source shows its colour.
    const src = display[p.from];
    const top = src[src.length - 1];
    if (top && top.hidden) { top.hidden = false; top.revealAt = now; }
    const others = pours.some(e => e !== p && (e.from === p.to || e.to === p.to));
    if (L.isComplete(state.bottles[p.to]) && !others) {
      corks.set(p.to, now + 100);
      setTimeout(() => {
        Fx.play('cork'); Fx.play('complete'); Fx.buzz('success');
        burst(slots[p.to].x, slots[p.to].top, 14, ['#ffe9a8', '#ffffff', p.color]);
      }, 330);
    }
  }

  function tick(now) {
    const drawn = new Map();
    for (const p of pours) drawn.set(p, step(p, now));
    const before = pours.length;
    pours = pours.filter(p => {
      const done = p.phase === 'return' && now - p.t0 >= MOVE + p.pourDur + RETURN;
      if (done) { lift[p.from] = 0; wobbles.set(p.from, { t0: now, amp: 0.08 }); }
      return !done;
    });
    if (before && !pours.length) syncDisplay();
    if (!pours.length && !state.won && L.isSolved(state.bottles)) onWin();
    return drawn;
  }

  // ---------- Particles ----------
  function splash(x, y, color) {
    particles.push({ kind: 'drop', x: x + (Math.random() - 0.5) * geom.nw * 0.3, y, y0: y, vx: (Math.random() - 0.5) * 1.4, vy: -0.8 - Math.random() * 1.8,
      r: 0.8 + Math.random() * geom.w * 0.03, color, life: 360, t0: performance.now() });
  }
  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, sp = 1.5 + Math.random() * 2.5;
      particles.push({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, r: 1.5 + Math.random() * 2.5,
        color: colors[i % colors.length], life: 650, t0: performance.now(), rot: Math.random() * 6 });
    }
  }
  function confetti() {
    const colors = L.COLORS.slice(0, 10);
    for (let i = 0; i < 140; i++) {
      particles.push({ kind: 'confetti', x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.42, vx: (Math.random() - 0.5) * 15, vy: -6 - Math.random() * 9,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 3, color: colors[i % colors.length], life: 2600 + Math.random() * 900, t0: performance.now(),
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35 });
    }
  }
  function drawParticles(now) {
    particles = particles.filter(p => now - p.t0 < p.life && !(p.kind === 'drop' && p.vy > 0 && p.y > p.y0));
    for (const p of particles) {
      const age = (now - p.t0) / p.life;
      if (p.kind === 'confetti') { p.vy += 0.3; p.vx *= 0.985; p.vy *= 0.99; p.rot += p.vr; }
      else if (p.kind === 'star') { p.vy += 0.1; p.vx *= 0.95; p.vy *= 0.95; p.rot += 0.08; }
      else p.vy += 0.25;
      p.x += p.vx; p.y += p.vy;
      ctx.globalAlpha = p.kind === 'confetti' ? Math.min(1, (1 - age) * 3) : 1 - age;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        const k = Math.abs(Math.cos(p.rot * 2));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, (-p.h / 2) * k, p.w, p.h * k + 0.5);
        ctx.restore();
      } else if (p.kind === 'star') {
        drawStar(p.x, p.y, p.r * (1 - age * 0.5), p.rot);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4, rr = i % 2 ? r * 0.4 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  // ---------- Frame ----------
  function frame(now) {
    const drawn = tick(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#cfd6ff';
    for (const s of stars) {
      ctx.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin((now / 1000) * s.sp + s.ph));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const flyingPose = new Map();
    for (const [p, d] of drawn) if (d) flyingPose.set(p.from, d.pose);

    const drawOne = i => {
      const s = slots[i];
      let pose = flyingPose.get(i);
      if (!pose) {
        lift[i] = lerp(lift[i] || 0, state.selected === i ? geom.h * 0.1 : 0, 0.3);
        pose = { x: s.x, y: s.top - lift[i], a: 0 };
      }
      if (shakes.has(i)) {
        const st = (now - shakes.get(i)) / 300;
        if (st >= 1) shakes.delete(i); else pose = { ...pose, x: pose.x + Math.sin(st * Math.PI * 5) * geom.w * 0.08 * (1 - st) };
      }
      let alpha = 1;
      if (born.has(i)) {
        const bt = (now - born.get(i)) / 400;
        if (bt >= 1) born.delete(i);
        else { const k = Math.max(0, bt); pose = { ...pose, y: pose.y - (1 - ease(k)) * geom.h * 0.4 }; alpha = k; }
      }
      let slope = 0;
      if (wobbles.has(i)) {
        const w = wobbles.get(i), wt = now - w.t0;
        if (wt > 1400) wobbles.delete(i); else slope = w.amp * Math.exp(-wt / 320) * Math.sin(wt / 55);
      }
      const layers = display[i].map(l => {
        let reveal = null;
        if (l.revealAt) { reveal = (now - l.revealAt) / 450; if (reveal >= 1) { l.revealAt = null; reveal = null; } }
        return { color: l.color, vol: l.vol, hidden: l.hidden, reveal };
      });
      const involved = pours.some(p => p.from === i || p.to === i);
      let cork = null;
      if (!involved && L.isComplete(state.bottles[i])) cork = corks.has(i) ? Math.max(0, Math.min(1, (now - corks.get(i)) / 360)) : 1;
      ctx.globalAlpha = alpha;
      Render.drawBottle(ctx, geom, pose, layers, { selected: state.selected === i, cork, slope, now });
      ctx.globalAlpha = 1;
    };

    for (let i = 0; i < state.bottles.length; i++) if (!flyingPose.has(i)) drawOne(i);
    for (const d of drawn.values()) if (d && d.stream) Render.drawStream(ctx, d.stream.from, d.stream.to, d.stream.color, d.stream.width, now);
    for (const i of flyingPose.keys()) drawOne(i);
    drawParticles(now);
    requestAnimationFrame(frame);
  }

  // ---------- Win ----------
  function onWin() {
    state.won = true;
    const reward = 10 + Math.floor(state.level / 5) * 5;
    const startCoins = state.coins;
    state.coins += reward;
    store.set('coins', state.coins);
    store.set('level', state.level + 1);
    setTimeout(() => {
      confetti();
      Fx.play('win'); Fx.buzz('success');
      $('win-reward').textContent = `+${reward}`;
      $('win').classList.remove('hidden');
      let k = 0;
      const t = setInterval(() => {
        k++;
        $('coins').textContent = Math.round(startCoins + (reward * k) / 10);
        if (k % 3 === 0) Fx.play('coin');
        if (k >= 10) { clearInterval(t); updateUI(); }
      }, 70);
    }, 650);
  }

  // ---------- Toolbar ----------
  function updateUI() {
    $('level').textContent = state.level;
    $('coins').textContent = state.coins;
    $('undo-count').textContent = state.undos;
    $('shuffle-count').textContent = state.shuffles;
    $('add-count').textContent = state.adds;
    $('undo').disabled = !state.history.length || !state.undos;
    $('shuffle').disabled = !state.shuffles;
    $('add-bottle').disabled = !state.adds;
  }

  $('undo').addEventListener('click', () => {
    if (pours.length || !state.history.length || !state.undos || state.won) return;
    state.bottles = state.history.pop();
    state.undos--;
    state.selected = null;
    syncDisplay();
    if (slots.length !== state.bottles.length) { layout(); lift = state.bottles.map(() => 0); }
    const now = performance.now();
    state.bottles.forEach((_, i) => wobbles.set(i, { t0: now, amp: 0.05 }));
    Fx.play('deselect'); Fx.buzz('light');
    updateUI();
  });

  $('shuffle').addEventListener('click', () => {
    if (pours.length || !state.shuffles || state.won) return;
    const before = L.clone(state.bottles);
    if (!L.shuffle(state.bottles)) { toast('Nothing to shuffle'); return; }
    state.history.push(before);
    state.shuffles--;
    state.selected = null;
    syncDisplay();
    const now = performance.now();
    state.bottles.forEach((b, i) => { if (b.length && !L.isComplete(b)) wobbles.set(i, { t0: now, amp: 0.16 }); });
    Fx.play('shuffle'); Fx.buzz('medium');
    updateUI();
  });

  $('add-bottle').addEventListener('click', () => {
    if (pours.length || !state.adds || state.won) return;
    state.history.push(L.clone(state.bottles));
    state.bottles.push([]);
    state.adds--;
    syncDisplay();
    layout();
    lift = state.bottles.map((_, i) => lift[i] || 0);
    born.set(state.bottles.length - 1, performance.now());
    Fx.play('select'); Fx.buzz('medium');
    updateUI();
  });

  // ---------- Settings ----------
  const settings = $('settings');
  function syncSettings() {
    $('opt-sound').classList.toggle('on', Fx.prefs.sound);
    $('opt-haptics').classList.toggle('on', Fx.prefs.haptics);
  }
  $('open-settings').addEventListener('click', () => { syncSettings(); settings.classList.remove('hidden'); });
  $('close-settings').addEventListener('click', () => settings.classList.add('hidden'));
  $('opt-sound').addEventListener('click', () => { Fx.setPref('sound', !Fx.prefs.sound); syncSettings(); Fx.play('select'); });
  $('opt-haptics').addEventListener('click', () => { Fx.setPref('haptics', !Fx.prefs.haptics); syncSettings(); Fx.buzz('medium'); });
  $('restart').addEventListener('click', () => { settings.classList.add('hidden'); startLevel(state.level); });
  $('next').addEventListener('click', () => startLevel(state.level + 1));

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 1600);
  }

  window.addEventListener('resize', layout);

  // Test hook (Playwright).
  window.HappySort = { state, slots: () => slots, geom: () => geom, pours: () => pours.map(p => ({ from: p.from, to: p.to, phase: p.phase })), display: () => display };

  const go = () => { startLevel(state.level); requestAnimationFrame(frame); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go); else go();
})();
