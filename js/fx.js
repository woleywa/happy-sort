// Happy Sort — sound and haptics.
// Sounds are modelled rather than beeped: glass clinks are a few inharmonic partials with a quick
// decay, water is a bed of soft filtered noise plus resonating bubbles (a sine that rises in pitch as
// it decays) whose pitch climbs as the bottle fills, all through a small generated room reverb.
// Haptics: Capacitor Haptics in the native apps, a short navigator.vibrate on Android, and on iPhone
// Safari (18+) the <input switch> trick. Kept to a few meaningful moments and always a single tap.
const Fx = (() => {
  const get = (k, d) => { try { const v = localStorage.getItem('happy-sort:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem('happy-sort:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const prefs = { sound: get('sound', true), haptics: get('haptics', true) };

  // ---------- Audio graph ----------
  let ac = null, dry = null, wet = null;
  function audio() {
    if (!prefs.sound) return null;
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      const out = ac.createGain(); out.gain.value = 0.9;
      comp.connect(out); out.connect(ac.destination);
      dry = ac.createGain(); dry.gain.value = 1; dry.connect(comp);
      // Small room: exponentially decaying stereo noise as the impulse response.
      const rev = ac.createConvolver();
      const len = Math.floor(ac.sampleRate * 1.1);
      const ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      rev.buffer = ir;
      wet = ac.createGain(); wet.gain.value = 0.22;
      wet.connect(rev); rev.connect(comp);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // One decaying sine partial, sent to dry + reverb.
  function partial(a, t, freq, vol, decay, o = {}) {
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || decay));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g); g.connect(dry); g.connect(wet);
    osc.start(t); osc.stop(t + decay + 0.05);
  }

  function noiseBuffer(a, dur) {
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; } // slightly pink
    return buf;
  }

  // A glass "clink": base pitch with inharmonic overtones.
  function clink(t, base, vol) {
    const a = ac;
    [[1, 1, 0.5], [2.76, 0.45, 0.32], [5.4, 0.22, 0.2], [8.93, 0.1, 0.12]].forEach(([m, v, d]) =>
      partial(a, t, base * m, vol * v, d));
  }

  // A resonating water bubble.
  function bubble(t, freq, vol) {
    partial(ac, t, freq, vol, 0.06 + Math.random() * 0.05, { to: freq * (1.5 + Math.random() * 0.4), attack: 0.002 });
  }

  const sound = {
    select() { const a = audio(); if (!a) return; clink(a.currentTime, 2100 + Math.random() * 120, 0.05); },
    deselect() { const a = audio(); if (!a) return; clink(a.currentTime, 1650, 0.03); },
    // A soft, dull tap — "that doesn't fit".
    nope() { const a = audio(); if (!a) return; partial(a, a.currentTime, 240, 0.05, 0.09, { to: 170 }); },
    // Water: a gentle stream plus bubbles whose pitch climbs as the target fills (0..4 units).
    pour(ms, fillFrom, fillTo) {
      const a = audio(); if (!a) return;
      const t0 = a.currentTime, dur = ms / 1000;
      const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur + 0.1);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(500 + fillFrom * 220, t0);
      bp.frequency.linearRampToValueAtTime(500 + fillTo * 220, t0 + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.06);
      g.gain.setValueAtTime(0.05, t0 + dur - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.05);
      src.connect(bp); bp.connect(g); g.connect(dry); g.connect(wet);
      src.start(t0);
      let t = 0.02;
      while (t < dur) {
        const fill = fillFrom + (fillTo - fillFrom) * (t / dur);
        bubble(t0 + t, 380 + fill * 170 + Math.random() * 120, 0.035 + Math.random() * 0.03);
        t += 0.035 + Math.random() * 0.06;
      }
    },
    // Cork settles: a soft thump and a little "tock".
    cork() {
      const a = audio(); if (!a) return;
      const t = a.currentTime;
      partial(a, t, 190, 0.12, 0.12, { to: 90 });
      const src = a.createBufferSource(); src.buffer = noiseBuffer(a, 0.04);
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = a.createGain(); g.gain.value = 0.15;
      src.connect(lp); lp.connect(g); g.connect(dry);
      src.start(t);
      clink(t + 0.01, 2600, 0.02);
    },
    // Finished bottle: a soft bell triad.
    complete() {
      const a = audio(); if (!a) return;
      const t = a.currentTime + 0.05;
      [784, 988, 1175].forEach((f, i) => { partial(a, t + i * 0.07, f, 0.045, 1.1); partial(a, t + i * 0.07, f * 2.01, 0.012, 0.6); });
    },
    shuffle() {
      const a = audio(); if (!a) return;
      for (let i = 0; i < 6; i++) clink(a.currentTime + i * 0.045, 1500 + i * 180, 0.025);
    },
    // Win: a marimba-like rising arpeggio, then a bell.
    win() {
      const a = audio(); if (!a) return;
      const t = a.currentTime;
      [523, 659, 784, 1047, 1319].forEach((f, i) => {
        partial(a, t + i * 0.09, f, 0.07, 0.45);
        partial(a, t + i * 0.09, f * 4, 0.012, 0.12);
      });
      [1568, 2093].forEach((f, i) => partial(a, t + 0.55 + i * 0.03, f, 0.03, 1.4));
    },
    coin() { const a = audio(); if (!a) return; clink(a.currentTime, 3000 + Math.random() * 300, 0.012); },
  };

  // ---------- Haptics ----------
  const C = window.Capacitor;
  const native = C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Haptics;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let iosSwitch = null;
  function iosTap() {
    if (!iosSwitch) {
      iosSwitch = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      iosSwitch.appendChild(input);
      iosSwitch.style.cssText = 'position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none';
      document.body.appendChild(iosSwitch);
    }
    iosSwitch.click();
  }
  const MS = { light: 6, medium: 12, success: 18 };
  // kind: light | medium | success
  function buzz(kind = 'light') {
    if (!prefs.haptics) return;
    try {
      if (native) {
        const H = C.Plugins.Haptics;
        if (kind === 'success') H.notification({ type: 'SUCCESS' });
        else H.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      } else if (navigator.vibrate) {
        navigator.vibrate(MS[kind] || 6);
      } else if (ios) {
        iosTap();
      }
    } catch (e) { /* haptics are a bonus */ }
  }

  function play(name, ...args) { if (prefs.sound && sound[name]) try { sound[name](...args); } catch (e) { /* ignore */ } }
  function setPref(k, v) { prefs[k] = v; set(k, v); }
  window.addEventListener('pointerdown', () => audio(), { once: true });

  return { play, buzz, prefs, setPref };
})();
