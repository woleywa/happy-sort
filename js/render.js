// Happy Sort — bottle geometry, liquid physics and canvas drawing.
//
// A bottle's inside is a polygon in local coordinates: origin at the centre of the mouth, y pointing
// down. A pose { x, y, a } places that origin on screen and rotates by a (radians, clockwise).
// Liquid always lies flat: each layer boundary is the horizontal line below which the tilted
// polygon holds exactly that much volume (found by bisection), which makes tilting and pouring look real.
const Render = (() => {
  // ---------- Geometry ----------
  function makeGeom(w, h) {
    const g = {
      w, h,
      t: Math.max(2, w * 0.05),   // glass thickness
      nw: w * 0.44,               // neck width
      neckH: h * 0.1,
      shH: h * 0.1,               // shoulder height
      r: w * 0.3,                 // bottom corner radius
    };
    g.inner = shape(g, g.t);
    g.lipX = g.nw / 2 - g.t;
    // Four units fill the body up to just under the shoulder.
    const fillY = g.neckH + g.shH + h * 0.05;
    g.unit = areaBelow(g.inner, fillY) / 4;
    g.fillY = fillY;
    g.angleCache = new Map();
    return g;
  }

  // Points around the bottle outline inset by d (d = 0 → outer glass, d = t → inside).
  function shape(g, d) {
    const nw = g.nw / 2 - d, w = g.w / 2 - d, h = g.h - d, r = Math.max(2, g.r - d);
    const yS = g.neckH, yB = g.neckH + g.shH;
    const pts = [];
    const quad = (x0, y0, cx, cy, x1, y1, n) => {
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
      }
    };
    const arc = (cx, cy, a0, a1, n) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    pts.push([-nw, 0], [-nw, yS]);
    quad(-nw, yS, -w, yS, -w, yB, 8);
    pts.push([-w, h - r]);
    arc(-w + r, h - r, Math.PI, Math.PI / 2, 8);
    arc(w - r, h - r, Math.PI / 2, 0, 8);
    pts.push([w, yB]);
    quad(w, yB, w, yS, nw, yS, 8);
    pts.push([nw, 0]);
    return pts;
  }

  function toWorld(pts, p) {
    const c = Math.cos(p.a), s = Math.sin(p.a);
    return pts.map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
  }

  function polyArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
      a += x0 * y1 - x1 * y0;
    }
    return Math.abs(a) / 2;
  }

  // Area of the part of the polygon below the horizontal line y (screen y grows downward).
  function areaBelow(pts, y) {
    const out = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const pin = p[1] >= y, qin = q[1] >= y;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (y - p[1]) / (q[1] - p[1]);
        out.push([p[0] + t * (q[0] - p[0]), y]);
      }
    }
    return out.length < 3 ? 0 : polyArea(out);
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  }

  // The y of the liquid surface when the polygon holds `vol` (area) of liquid.
  function surface(pts, vol, bb = bbox(pts)) {
    let lo = bb.y0, hi = bb.y1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (areaBelow(pts, mid) > vol) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // How far to tilt (toward dir = ±1) so liquid of `units` just reaches the lip of the mouth.
  function pourAngle(g, units, dir) {
    const key = Math.round(units * 50);
    let a = g.angleCache.get(key);
    if (a == null) {
      const vol = units * g.unit;
      let lo = 0, hi = 2.05;
      if (vol > 0.5) {
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          const world = toWorld(g.inner, { x: 0, y: 0, a: mid });
          const lipY = g.lipX * Math.sin(mid);
          if (surface(world, vol) <= lipY + 1) hi = mid; else lo = mid;
        }
      }
      a = Math.max(0.55, hi);
      g.angleCache.set(key, a);
    }
    return a * dir;
  }

  // Lip of the mouth that points toward dir, in screen coordinates.
  function lip(g, pose, dir) {
    const [[x, y]] = toWorld([[dir * g.lipX, 0]], pose);
    return { x, y };
  }

  // ---------- Colour helpers ----------
  function mix(hex, other, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
    const ch = (v, s) => (v >> s) & 255;
    const m = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
    return `rgb(${m(16)},${m(8)},${m(0)})`;
  }
  const HIDDEN = '#1a1b3a';

  // ---------- Drawing ----------
  function outerPath(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function applyPose(ctx, p) {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
  }

  /**
   * layers: [{ color, vol (units), hidden, reveal (0..1, optional) }] bottom first.
   * o: { selected, complete, cork (0..1 drop progress, or null), slope (wobble), glow (0..1), now }
   */
  function drawBottle(ctx, g, pose, layers, o = {}) {
    if (!g.outer) g.outer = shape(g, 0);
    const world = toWorld(g.inner, pose);
    const bb = bbox(world);

    // Glow behind finished bottles.
    if (o.complete) {
      const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      const pulse = 0.75 + 0.25 * Math.sin((o.now || 0) / 400);
      const rg = ctx.createRadialGradient(cx, cy, g.w * 0.2, cx, cy, g.h * 0.75);
      rg.addColorStop(0, `rgba(255,220,120,${0.35 * pulse})`);
      rg.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(cx - g.h, cy - g.h, g.h * 2, g.h * 2);
    }

    // Back of the glass.
    ctx.save();
    applyPose(ctx, pose);
    outerPath(ctx, g.outer);
    const back = ctx.createLinearGradient(-g.w / 2, 0, g.w / 2, 0);
    back.addColorStop(0, 'rgba(120,150,255,0.16)');
    back.addColorStop(0.5, 'rgba(40,50,120,0.28)');
    back.addColorStop(1, 'rgba(120,150,255,0.16)');
    ctx.fillStyle = back;
    ctx.fill();
    ctx.restore();

    // Liquid.
    const vis = layers.filter(l => l.vol > 0.002);
    if (vis.length) {
      ctx.save();
      outerPath(ctx, world);
      ctx.clip();
      const cx = (bb.x0 + bb.x1) / 2;
      const s = o.slope || 0;
      const X0 = bb.x0 - 4, X1 = bb.x1 + 4;
      const band = (yTop, yBot) => {
        ctx.beginPath();
        ctx.moveTo(X0, yTop + (X0 - cx) * s);
        ctx.lineTo(X1, yTop + (X1 - cx) * s);
        ctx.lineTo(X1, yBot + (X1 - cx) * s);
        ctx.lineTo(X0, yBot + (X0 - cx) * s);
        ctx.closePath();
      };
      let cum = 0, prev = bb.y1 + g.h;
      const bands = [];
      for (const l of vis) {
        cum += l.vol * g.unit;
        const y = surface(world, cum, bb);
        bands.push({ l, top: y, bot: prev });
        prev = y;
      }
      const topY = prev;
      for (const { l, top, bot } of bands) {
        band(top, bot);
        const r = l.reveal;
        if (l.hidden) ctx.fillStyle = HIDDEN;
        else if (r != null && r < 1) ctx.fillStyle = r < 0.35 ? mix(HIDDEN, '#ffffff', r / 0.35) : mix('#ffffff', l.color, (r - 0.35) / 0.65);
        else ctx.fillStyle = l.color;
        ctx.fill();
      }
      // Volume shading, only below the top surface.
      ctx.save();
      band(topY, bb.y1 + g.h);
      ctx.clip();
      ctx.save();
      applyPose(ctx, pose);
      const sh = ctx.createLinearGradient(-g.w / 2, 0, g.w / 2, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.28)');
      sh.addColorStop(0.22, 'rgba(255,255,255,0.10)');
      sh.addColorStop(0.45, 'rgba(255,255,255,0)');
      sh.addColorStop(0.8, 'rgba(0,0,0,0.12)');
      sh.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = sh;
      ctx.fillRect(-g.w, -g.h, g.w * 2, g.h * 3);
      ctx.restore();
      ctx.restore();
      // Shine on the top surface and faint lines between layers.
      const top = bands[bands.length - 1];
      if (!top.l.hidden) {
        band(topY - 1, topY + Math.max(3, g.h * 0.022));
        ctx.fillStyle = mix(top.l.color.startsWith('#') ? top.l.color : '#888888', '#ffffff', 0.4);
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < bands.length - 1; i++) {
        if (bands[i].l.color === bands[i + 1].l.color && !bands[i].l.hidden && !bands[i + 1].l.hidden) continue;
        const y = bands[i].top;
        ctx.beginPath();
        ctx.moveTo(X0, y + (X0 - cx) * s);
        ctx.lineTo(X1, y + (X1 - cx) * s);
        ctx.stroke();
      }
      // "?" on hidden layers.
      ctx.fillStyle = 'rgba(150,155,230,0.75)';
      ctx.font = `900 ${Math.round(g.w * 0.36)}px "Fredoka", "Trebuchet MS", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { l, top, bot } of bands) {
        if (!l.hidden) continue;
        const y = (top + Math.min(bot, bb.y1)) / 2;
        const xs = chord(world, y);
        if (xs) ctx.fillText('?', (xs[0] + xs[1]) / 2, y);
      }
      ctx.restore();
    }

    // Front of the glass: rim, outline, highlights, cork.
    ctx.save();
    applyPose(ctx, pose);
    outerPath(ctx, g.outer);
    if (o.selected) {
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = 18;
    }
    ctx.lineWidth = Math.max(2, g.w * 0.035);
    ctx.strokeStyle = o.selected ? 'rgba(255,255,255,0.95)' : 'rgba(200,220,255,0.7)';
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Long highlight on the left, short on the right.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = g.w * 0.07;
    ctx.beginPath();
    ctx.moveTo(-g.w * 0.3, g.neckH + g.shH + g.h * 0.06);
    ctx.lineTo(-g.w * 0.3, g.h - g.r - g.h * 0.02);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = g.w * 0.05;
    ctx.beginPath();
    ctx.moveTo(g.w * 0.3, g.neckH + g.shH + g.h * 0.08);
    ctx.lineTo(g.w * 0.3, g.neckH + g.shH + g.h * 0.2);
    ctx.stroke();
    // Rim.
    const rw = g.nw + g.w * 0.12, rh = Math.max(5, g.h * 0.035);
    roundRect(ctx, -rw / 2, -rh / 2, rw, rh, rh / 2);
    ctx.fillStyle = 'rgba(160,185,255,0.35)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, g.w * 0.03);
    ctx.strokeStyle = 'rgba(220,235,255,0.8)';
    ctx.stroke();
    if (o.cork != null) drawCork(ctx, g, o.cork);
    ctx.restore();
  }

  function drawCork(ctx, g, p) {
    // p: 0 → just appearing above, 1 → seated (with a little bounce in between).
    const e = p >= 1 ? 1 : easeOutBack(p);
    const cw = g.nw * 1.05, ch = g.h * 0.12;
    const y = -ch * 0.55 - (1 - e) * g.h * 0.35;
    ctx.globalAlpha = Math.min(1, p * 3);
    const gr = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0);
    gr.addColorStop(0, '#9a5a2a');
    gr.addColorStop(0.35, '#e0a060');
    gr.addColorStop(1, '#7a4220');
    roundRect(ctx, -cw / 2, y, cw, ch, cw * 0.18);
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,40,10,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(80,40,10,0.35)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-cw * 0.25 + (i % 2) * cw * 0.4, y + ch * (0.3 + 0.2 * i), Math.max(1, cw * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function chord(pts, y) {
    const xs = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p[1] - y) * (q[1] - y) < 0) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    if (xs.length < 2) return null;
    return [Math.min(...xs), Math.max(...xs)];
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // The stream of liquid from a lip down to a landing point.
  function drawStream(ctx, from, to, color, width, now) {
    if (width <= 0.3) return;
    ctx.save();
    ctx.lineCap = 'round';
    const wob = Math.sin(now / 40) * width * 0.15;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x, from.y + (to.y - from.y) * 0.3, to.x + wob, to.y - (to.y - from.y) * 0.4, to.x, to.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = width * 0.3;
    ctx.stroke();
    ctx.restore();
  }

  return { makeGeom, toWorld, surface, bbox, pourAngle, lip, drawBottle, drawStream, roundRect, mix };
})();
