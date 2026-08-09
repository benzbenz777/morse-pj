'use strict';

const MorseAudio = (() => {
  let ctx = null;
  let masterGain = null;
  let scheduled = [];          // Array of {stopTime, gain, osc, callback, look}
  let playing = false;
  let onStopCallback = null;
  let onCharCallback = null;

  const DEFAULT_UNIT_MS = 70;
  const FREQ = 700;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.6;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setVolume(v) {
    if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  function tone(startTime, durSec) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = FREQ;
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.exponentialRampToValueAtTime(masterGain.gain.value, startTime + 0.005);
    g.gain.setValueAtTime(masterGain.gain.value, startTime + durSec - 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + durSec);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + durSec + 0.01);
    return { stopTime: startTime + durSec + 0.01, gain: g, osc };
  }

  // tokens: array of {type:'char'|'space'|'skip', char, code, index}
  // Returns { elems: [{t,dur,type}], chars: [{tokenIndex,start,end}], endTime }
  function buildTimeline(tokens, unitMs) {
    const unit = unitMs / 1000;
    const elems = [];
    const chars = [];
    let t = ctx.currentTime + 0.1;
    for (const tk of tokens) {
      if (tk.type === 'space') {
        t += 7 * unit;            // word gap
        continue;
      }
      if (tk.type !== 'char') continue;
      const charStart = t;
      for (let i = 0; i < tk.code.length; i++) {
        const s = tk.code[i];
        if (s === '.') {
          elems.push({ t, dur: unit, type: 'dit' });
          t += unit + unit;               // tone + intra-char gap
        } else if (s === '-') {
          elems.push({ t, dur: 3 * unit, type: 'dah' });
          t += 3 * unit + unit;
        }
      }
      t += 2 * unit;                      // extra to make inter-char gap 3 units
      chars.push({ tokenIndex: tk.index, start: charStart, end: t });
    }
    return { elems, chars, endTime: t };
  }

  function play(tokens, unitMs, onChar) {
    stop();
    const c = ensureCtx();
    const { elems, chars, endTime } = buildTimeline(tokens, unitMs);
    if (elems.length === 0) return 0;
    for (const e of elems) {
      scheduled.push(tone(e.t, e.dur));
    }
    playing = true;
    onCharCallback = onChar || null;

    let curIdx = -1;
    const look = setInterval(function () {
      if (!playing) return;
      const now = c.currentTime;
      let idx = -1;
      for (let i = 0; i < chars.length; i++) {
        if (now >= chars[i].start && now < chars[i].end) { idx = chars[i].tokenIndex; break; }
      }
      if (idx !== curIdx) {
        curIdx = idx;
        if (onCharCallback) onCharCallback(idx);
      }
      if (now >= endTime) stop();
    }, 60);
    scheduled.push({ look });

    const checkEnd = function () {
      if (!playing) return;
      if (c.currentTime >= endTime) stop();
      else setTimeout(checkEnd, 100);
    };
    scheduled.push({ callback: checkEnd });
    return (endTime - c.currentTime) * 1000;
  }

  function stop() {
    playing = false;
    for (const s of scheduled) {
      if (s.osc) { try { s.osc.stop(); } catch (e) {} }
      if (s.gain) { try { s.gain.disconnect(); } catch (e) {} }
      if (s.look) clearInterval(s.look);
      if (s.callback) clearTimeout(s.callback);
    }
    scheduled = [];
    if (onCharCallback) { const f = onCharCallback; onCharCallback = null; f(-1); }
    if (onStopCallback) { const f = onStopCallback; onStopCallback = null; f(); }
  }

  function isPlaying() { return playing; }
  function onStop(fn) { onStopCallback = fn; }

  return { play, stop, setVolume, isPlaying, onStop, ensureCtx, DEFAULT_UNIT_MS };
})();
