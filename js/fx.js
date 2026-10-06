// Happy Sort — sound (synthesised with Web Audio, no files) and haptics.
// Haptics: the Capacitor Haptics plugin in the native apps, navigator.vibrate on Android browsers,
// and on iPhone Safari (18+) the trick of toggling a hidden <input switch>, which gives a light tap.
const Fx = (() => {
  const get = (k, d) => { try { const v = localStorage.getItem('happy-sort:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem('happy-sort:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const prefs = { sound: get('sound', true), haptics: get('haptics', true) };

  // ---------- Sound ----------
  let ac = null, master = null;
  function audio() {
    if (!prefs.sound) return null;
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
      master = ac.createGain();
      master.gain.value = 0.55;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur, o = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + (o.delay || 0);
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const vol = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, o = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + (o.delay || 0);
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.value = o.freq || 1200; f.Q.value = o.q || 1;
    const g = a.createGain(); g.gain.value = o.vol == null ? 0.2 : o.vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  const sound = {
    select() { tone(720, 0.07, { type: 'triangle', vol: 0.16, to: 900 }); },
    deselect() { tone(600, 0.07, { type: 'triangle', vol: 0.12, to: 450 }); },
    error() { tone(170, 0.09, { type: 'square', vol: 0.06 }); tone(140, 0.12, { type: 'square', vol: 0.06, delay: 0.09 }); },
    // Glugs that rise in pitch as the target bottle fills up.
    pour(units, ms, fillFrom) {
      const steps = Math.max(3, Math.round(ms / 85));
      for (let i = 0; i < steps; i++) {
        const fill = fillFrom + (units * i) / steps;
        const f = 260 + fill * 90 + Math.random() * 40;
        tone(f, 0.07, { type: 'sine', vol: 0.13, to: f * 1.6, delay: i * (ms / 1000) / steps });
      }
      noise(ms / 1000, { filter: 'lowpass', freq: 900, vol: 0.05 });
    },
    pop() { noise(0.05, { freq: 1600, q: 2, vol: 0.35 }); tone(900, 0.12, { type: 'sine', vol: 0.2, to: 300 }); },
    complete() { [1047, 1319, 1568].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.12, delay: 0.05 + i * 0.07 })); },
    whoosh() { noise(0.35, { freq: 700, q: 0.7, vol: 0.18 }); },
    win() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.14, delay: i * 0.09 }));
      [2093, 2637, 3136].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.06, delay: 0.5 + i * 0.06 }));
    },
    coin() { tone(1319, 0.08, { type: 'square', vol: 0.05 }); tone(1760, 0.14, { type: 'square', vol: 0.05, delay: 0.07 }); },
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
  // kind: light | medium | heavy | success | error
  const PATTERNS = { light: [10], medium: [20], heavy: [35], success: [15, 60, 25], error: [30, 40, 30] };
  const IOS_TAPS = { light: 1, medium: 1, heavy: 2, success: 2, error: 3 };
  function buzz(kind = 'light') {
    if (!prefs.haptics) return;
    try {
      if (native) {
        const H = C.Plugins.Haptics;
        if (kind === 'success') H.notification({ type: 'SUCCESS' });
        else if (kind === 'error') H.notification({ type: 'ERROR' });
        else H.impact({ style: kind.toUpperCase() });
      } else if (navigator.vibrate) {
        navigator.vibrate(PATTERNS[kind] || [10]);
      } else if (ios) {
        for (let i = 0; i < (IOS_TAPS[kind] || 1); i++) setTimeout(iosTap, i * 70);
      }
    } catch (e) { /* haptics are a bonus */ }
  }

  function play(name, ...args) { if (prefs.sound && sound[name]) try { sound[name](...args); } catch (e) { /* ignore */ } }
  function setPref(k, v) { prefs[k] = v; set(k, v); }
  // Browsers only allow audio after a user gesture.
  window.addEventListener('pointerdown', () => audio(), { once: true });

  return { play, buzz, prefs, setPref };
})();
