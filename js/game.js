// Happy Sort — game screen: state, input, animations and effects. Rules live in logic.js,
// drawing in render.js, sound and haptics in fx.js.
(() => {
  'use strict';
  const L = window.Logic;
  const CAP = L.CAPACITY;
  const $ = id => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('happy-sort:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('happy-sort:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // Timings (ms).
  const MOVE = 300, RETURN = 320, PER_UNIT = 240, POUR_EXTRA = 160;

  const state = {
    level: store.get('level', 1),
    coins: store.get('coins', 0),
    bottles: [],
    history: [],
    selected: null,
    undos: 0, shuffles: 0, adds: 0,
    won: false,
  };

  // View state.
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let geom = null, slots = [];
  let lift = [];             // current lift per bottle (eased toward target)
  let anims = [];            // running pours
  const busy = new Set();    // bottles taking part in a pour
  const reveals = new Map(); // 'bottle:index' → start time
  const corks = new Map();   // bottle → time its cork started to drop
  const shakes = new Map();  // bottle → start time
  const wobbles = new Map(); // bottle → { t0, amp }
  const born = new Map();    // bottle → time it appeared (extra bottle)
  let particles = [];
  let stars = [];

  // ---------- Levels ----------
  function startLevel(level) {
    state.level = level;
    state.bottles = L.generateLevel(level);
    state.history = [];
    state.selected = null;
    state.undos = 5; state.shuffles = 1; state.adds = 1;
    state.won = false;
    anims = []; busy.clear(); reveals.clear(); corks.clear(); shakes.clear(); wobbles.clear(); born.clear();
    particles = particles.filter(p => p.kind === 'confetti');
    store.set('level', level);
    $('win').classList.add('hidden');
    layout();
    lift = state.bottles.map(() => 0);
    // Bottles drop in one after another.
    const now = performance.now();
    state.bottles.forEach((_, i) => born.set(i, now + i * 45));
    updateUI();
  }

  // ---------- Layout ----------
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const top = $('level-badge').getBoundingClientRect().bottom + 12;
    const bottom = $('toolbar').getBoundingClientRect().top - 12;
    const n = state.bottles.length;
    const rows = Math.max(1, Math.ceil(n / 5));
    const perRow = Math.ceil(n / rows);
    const availW = Math.min(W, 560) - 24;
    const availH = bottom - top;
    const RATIO = 3.05;
    let w = Math.min((availW / perRow) * 0.68, 76);
    let h = w * RATIO;
    const liftRoom = h * 0.14;
    const gapY = h * 0.2;
    const need = rows * (h + liftRoom) + (rows - 1) * gapY;
    if (need > availH) {
      const k = availH / need;
      w *= k; h *= k;
    }
    geom = Render.makeGeom(w, h);
    const room = h * 0.14, gy = h * 0.2;
    const total = rows * (h + room) + (rows - 1) * gy;
    let y = top + (availH - total) / 2 + room;
    slots = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const count = Math.min(perRow, n - i);
      const gapX = Math.min(availW / perRow, w * 1.75);
      const x0 = W / 2 - ((count - 1) * gapX) / 2;
      for (let c = 0; c < count; c++, i++) slots.push({ x: x0 + c * gapX, top: y });
      y += h + room + gy;
    }
    // Twinkling stars in the background.
    const count = Math.round((W * H) / 9000);
    const rand = L.rng(42);
    stars = Array.from({ length: count }, () => ({ x: rand() * W, y: rand() * H, r: 0.4 + rand() * 1.3, ph: rand() * 6.28, sp: 0.4 + rand() * 1.2 }));
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
      if (i >= state.bottles.length) return;
      const inX = Math.abs(x - s.x) <= geom.w * 0.75;
      const inY = y >= s.top - geom.h * 0.25 && y <= s.top + geom.h + 12;
      if (inX && inY) { const d = Math.abs(x - s.x); if (d < bestD) { bestD = d; best = i; } }
    });
    return best;
  }

  function onBottleTap(i) {
    if (busy.has(i)) return;
    const b = state.bottles[i];
    if (state.selected == null) {
      if (!b.length || L.isComplete(b)) { shake(i); return; }
      state.selected = i;
      Fx.play('select'); Fx.buzz('light');
      return;
    }
    const from = state.selected;
    if (from === i) { state.selected = null; Fx.play('deselect'); return; }
    if (!L.canPour(state.bottles, from, i)) {
      shake(i);
      state.selected = null;
      return;
    }
    state.selected = null;
    startPour(from, i);
  }

  function shake(i) {
    shakes.set(i, performance.now());
    Fx.play('error'); Fx.buzz('error');
  }

  // ---------- Pouring ----------
  function startPour(from, to) {
    const before = L.clone(state.bottles);
    const src = before[from], dst = before[to];
    const n = Math.min(L.topRun(src), CAP - dst.length);
    const color = L.COLORS[src[src.length - 1].c];
    const revealIdx = src.length - n - 1; // layer that becomes the new top
    const willReveal = revealIdx >= 0 && src[revealIdx].hidden;
    state.history.push(before);
    L.pour(state.bottles, from, to);
    busy.add(from); busy.add(to);
    const sx = slots[from].x, tx = slots[to].x;
    // The tilted bottle lies on the side away from its lip; keep it on screen.
    let dir = Math.abs(tx - sx) > 4 ? Math.sign(tx - sx) : (tx >= W / 2 ? 1 : -1);
    const reach = geom.h * 0.85;
    if (dir > 0 && tx - reach < 0) dir = -1;
    else if (dir < 0 && tx + reach > W) dir = 1;
    const pourDur = n * PER_UNIT + POUR_EXTRA;
    anims.push({ from, to, n, color, src, dst, dir, pourDur, t0: performance.now(), startLift: lift[from], phase: 0, revealIdx: willReveal ? revealIdx : -1 });
    Fx.play('whoosh');
    updateUI();
  }

  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  function poseForAngle(a, anim) {
    // Put the lip of the source just above the target's mouth.
    const t = slots[anim.to];
    const P = { x: t.x - anim.dir * geom.w * 0.12, y: t.top - geom.h * 0.16 };
    const c = Math.cos(a), s = Math.sin(a);
    const lx = anim.dir * geom.lipX;
    return { x: P.x - lx * c, y: P.y - lx * s, a };
  }

  function units(layers) { return layers.reduce((n, l) => n + l.vol, 0); }

  // Advances a pour; returns { pose, srcLayers, dstLayers, stream } for drawing.
  function stepPour(a, now) {
    const t = now - a.t0;
    const total = a.src.length;
    const home = { x: slots[a.from].x, y: slots[a.from].top - a.startLift, a: 0 };
    const rest = { x: slots[a.from].x, y: slots[a.from].top, a: 0 };
    const toLayers = arr => arr.map(l => ({ color: L.COLORS[l.c], vol: 1, hidden: l.hidden }));
    let moved = 0, pose, stream = null;
    if (t < MOVE) {
      const p = ease(t / MOVE);
      const target = poseForAngle(Render.pourAngle(geom, total, a.dir), a);
      pose = { x: lerp(home.x, target.x, p), y: lerp(home.y, target.y, p), a: lerp(0, target.a, p) };
    } else if (t < MOVE + a.pourDur) {
      if (a.phase === 0) {
        a.phase = 1;
        Fx.play('pour', a.n, a.pourDur, a.dst.length); Fx.buzz('light');
      }
      const pp = (t - MOVE) / a.pourDur;
      moved = a.n * ease(pp);
      pose = poseForAngle(Render.pourAngle(geom, total - moved, a.dir), a);
      const env = Math.max(0, Math.min(1, pp * 7, (1 - pp) * 5));
      const lp = Render.lip(geom, pose, a.dir);
      // Where the stream lands: the target's liquid surface.
      const tPose = { x: slots[a.to].x, y: slots[a.to].top, a: 0 };
      const filled = (a.dst.length + moved) * geom.unit;
      const ty = filled > 0 ? Render.surface(Render.toWorld(geom.inner, tPose), filled) : slots[a.to].top + geom.h - geom.t;
      stream = { from: lp, to: { x: slots[a.to].x, y: ty }, width: geom.nw * 0.36 * env, color: a.color };
      if (Math.random() < 0.6) splash(slots[a.to].x, ty, a.color);
    } else {
      if (a.phase === 1) finishPour(a, now);
      const p = ease(Math.min(1, (t - MOVE - a.pourDur) / RETURN));
      const from = poseForAngle(Render.pourAngle(geom, total - a.n, a.dir), a);
      pose = { x: lerp(from.x, rest.x, p), y: lerp(from.y, rest.y, p), a: lerp(from.a, 0, p) };
      moved = a.n;
    }
    // Source: the top n layers drain away.
    const srcLayers = toLayers(a.src);
    let left = moved;
    for (let i = srcLayers.length - 1; i >= 0 && left > 0; i--) {
      const take = Math.min(1, left);
      srcLayers[i].vol -= take; left -= take;
    }
    const dstLayers = toLayers(a.dst);
    if (moved > 0 && a.phase < 2) dstLayers.push({ color: a.color, vol: moved, hidden: false });
    return { pose, srcLayers, dstLayers, stream };
  }

  function finishPour(a, now) {
    a.phase = 2;
    busy.delete(a.to);
    wobbles.set(a.to, { t0: now, amp: 0.12 });
    if (a.revealIdx >= 0) reveals.set(`${a.from}:${a.revealIdx}`, now);
    if (L.isComplete(state.bottles[a.to])) {
      corks.set(a.to, now + 120);
      setTimeout(() => {
        Fx.play('pop'); Fx.play('complete'); Fx.buzz('success');
        burst(slots[a.to].x, slots[a.to].top, 18, ['#ffe27a', '#fff3c4', '#ffd23f', a.color]);
      }, 260);
    }
  }

  function tickAnims(now) {
    anims = anims.filter(a => {
      const done = now - a.t0 >= MOVE + a.pourDur + RETURN;
      if (done) {
        if (a.phase < 2) finishPour(a, now);
        busy.delete(a.from);
        lift[a.from] = 0;
        wobbles.set(a.from, { t0: now, amp: 0.1 });
      }
      return !done;
    });
    if (!anims.length && !state.won && L.isSolved(state.bottles)) onWin();
  }

  // ---------- Particles ----------
  function splash(x, y, color) {
    for (let i = 0; i < 2; i++) {
      particles.push({ kind: 'drop', x: x + (Math.random() - 0.5) * geom.nw * 0.4, y, vx: (Math.random() - 0.5) * 1.6, vy: -1 - Math.random() * 2.2,
        r: 1 + Math.random() * geom.w * 0.035, color, life: 380, t0: performance.now(), y0: y });
    }
  }
  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, sp = 2 + Math.random() * 3;
      particles.push({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, r: 2 + Math.random() * 3,
        color: colors[i % colors.length], life: 700, t0: performance.now(), rot: Math.random() * 6 });
    }
  }
  function confetti() {
    const colors = L.COLORS.slice(0, 10);
    for (let i = 0; i < 160; i++) {
      particles.push({ kind: 'confetti', x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.42, vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 10,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, color: colors[i % colors.length], life: 2600 + Math.random() * 900, t0: performance.now(),
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
    }
  }
  function drawParticles(now) {
    // Splash drops vanish when they fall back into the liquid.
    particles = particles.filter(p => now - p.t0 < p.life && !(p.kind === 'drop' && p.vy > 0 && p.y > p.y0));
    for (const p of particles) {
      const age = (now - p.t0) / p.life;
      if (p.kind === 'confetti') { p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.99; p.rot += p.vr; }
      else if (p.kind === 'star') { p.vy += 0.12; p.vx *= 0.96; p.vy *= 0.96; p.rot += 0.1; }
      else p.vy += 0.25;
      p.x += p.vx; p.y += p.vy;
      ctx.globalAlpha = p.kind === 'confetti' ? Math.min(1, (1 - age) * 3) : 1 - age;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.rot * 2)), p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 0.5);
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
    tickAnims(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (const s of stars) {
      ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(now / 1000 * s.sp + s.ph));
      ctx.fillStyle = '#cfd6ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const n = state.bottles.length;
    const pourInfo = new Map();
    for (const a of anims) pourInfo.set(a, stepPour(a, now));
    const srcOf = new Map(), dstOf = new Map();
    for (const [a, info] of pourInfo) { srcOf.set(a.from, info); if (a.phase < 2) dstOf.set(a.to, info); }

    const drawOne = i => {
      const s = slots[i];
      const target = state.selected === i ? geom.h * 0.1 : 0;
      if (!srcOf.has(i)) lift[i] = lerp(lift[i] || 0, target, 0.3);
      let pose, layers;
      if (srcOf.has(i)) {
        const info = srcOf.get(i);
        pose = info.pose; layers = info.srcLayers;
      } else {
        pose = { x: s.x, y: s.top - lift[i], a: 0 };
        layers = dstOf.has(i) ? dstOf.get(i).dstLayers : state.bottles[i].map((l, li) => {
          const key = `${i}:${li}`;
          let reveal = null;
          if (reveals.has(key)) {
            reveal = (now - reveals.get(key)) / 500;
            if (reveal >= 1) { reveals.delete(key); reveal = null; }
          }
          return { color: L.COLORS[l.c], vol: 1, hidden: l.hidden, reveal };
        });
      }
      // Shake (refused pour), drop-in (new level / extra bottle).
      if (shakes.has(i)) {
        const st = (now - shakes.get(i)) / 320;
        if (st >= 1) shakes.delete(i); else pose.x += Math.sin(st * Math.PI * 6) * geom.w * 0.1 * (1 - st);
      }
      let alpha = 1;
      if (born.has(i)) {
        const bt = (now - born.get(i)) / 420;
        if (bt >= 1) born.delete(i);
        else { const k = Math.max(0, bt); pose.y -= (1 - ease(k)) * geom.h * 0.5; alpha = Math.max(0, k); }
      }
      let slope = 0;
      if (wobbles.has(i)) {
        const w = wobbles.get(i), wt = now - w.t0;
        if (wt > 1400) wobbles.delete(i); else slope = w.amp * Math.exp(-wt / 350) * Math.sin(wt / 55);
      }
      const complete = !busy.has(i) && L.isComplete(state.bottles[i]);
      let cork = null;
      if (complete) cork = corks.has(i) ? Math.max(0, Math.min(1, (now - corks.get(i)) / 380)) : 1;
      ctx.globalAlpha = alpha;
      Render.drawBottle(ctx, geom, pose, layers, { selected: state.selected === i, complete, cork, slope, now });
      ctx.globalAlpha = 1;
    };

    for (let i = 0; i < n; i++) if (!srcOf.has(i)) drawOne(i);
    for (const info of pourInfo.values()) if (info.stream) Render.drawStream(ctx, info.stream.from, info.stream.to, info.stream.color, info.stream.width, now);
    for (const a of anims) drawOne(a.from);
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
      // Coins count up.
      let k = 0;
      const tick = setInterval(() => {
        k++;
        $('coins').textContent = Math.round(startCoins + (reward * k) / 10);
        if (k % 2) Fx.play('coin');
        if (k >= 10) { clearInterval(tick); updateUI(); }
      }, 70);
    }, 450);
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

  function press(el) {
    el.classList.remove('pressed'); void el.offsetWidth; el.classList.add('pressed');
    Fx.buzz('medium');
  }

  $('undo').addEventListener('click', e => {
    if (anims.length || !state.history.length || !state.undos || state.won) return;
    press(e.currentTarget);
    state.bottles = state.history.pop();
    state.undos--;
    state.selected = null;
    if (slots.length !== state.bottles.length) { layout(); lift = state.bottles.map(() => 0); }
    state.bottles.forEach((_, i) => wobbles.set(i, { t0: performance.now(), amp: 0.06 }));
    Fx.play('deselect');
    updateUI();
  });

  $('shuffle').addEventListener('click', e => {
    if (anims.length || !state.shuffles || state.won) return;
    press(e.currentTarget);
    const before = L.clone(state.bottles);
    if (!L.shuffle(state.bottles)) { toast('Nothing to shuffle'); return; }
    state.history.push(before);
    state.shuffles--;
    state.selected = null;
    const now = performance.now();
    state.bottles.forEach((b, i) => {
      if (L.isComplete(b) || !b.length) return;
      wobbles.set(i, { t0: now, amp: 0.2 });
      burst(slots[i].x, slots[i].top + geom.h * 0.6, 8, ['#c9b6ff', '#ffffff', '#8f6bff']);
    });
    Fx.play('whoosh'); Fx.play('complete');
    updateUI();
  });

  $('add-bottle').addEventListener('click', e => {
    if (anims.length || !state.adds || state.won) return;
    press(e.currentTarget);
    state.history.push(L.clone(state.bottles));
    state.bottles.push([]);
    state.adds--;
    layout();
    lift = state.bottles.map((_, i) => lift[i] || 0);
    born.set(state.bottles.length - 1, performance.now());
    Fx.play('pop');
    updateUI();
  });

  // ---------- Settings ----------
  const settings = $('settings');
  function syncSettings() {
    $('opt-sound').classList.toggle('on', Fx.prefs.sound);
    $('opt-haptics').classList.toggle('on', Fx.prefs.haptics);
  }
  $('open-settings').addEventListener('click', () => { syncSettings(); settings.classList.remove('hidden'); Fx.buzz('light'); });
  $('close-settings').addEventListener('click', () => settings.classList.add('hidden'));
  $('opt-sound').addEventListener('click', () => { Fx.setPref('sound', !Fx.prefs.sound); syncSettings(); Fx.play('select'); });
  $('opt-haptics').addEventListener('click', () => { Fx.setPref('haptics', !Fx.prefs.haptics); syncSettings(); Fx.buzz('medium'); });
  $('restart').addEventListener('click', () => { settings.classList.add('hidden'); startLevel(state.level); });
  $('next').addEventListener('click', () => { Fx.buzz('medium'); startLevel(state.level + 1); });

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 1600);
  }

  window.addEventListener('resize', () => { layout(); });

  // Test hook (Playwright): read state and force layouts.
  window.HappySort = { state, slots: () => slots, geom: () => geom, busy: () => anims.length > 0 };

  const begin = () => { startLevel(state.level); requestAnimationFrame(frame); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(begin, begin); else begin();
})();
