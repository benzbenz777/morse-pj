'use strict';

const MorseAudio = (() => {
  let ctx = null;
  let masterGain = null;
  let limiter = null;
  let scheduled = [];          // Array of {stopTime, gain, osc, callback, look}
  let playing = false;
  let onStopCallback = null;
  let onCharCallback = null;

  const DEFAULT_UNIT_MS = 70;
  const DEFAULT_FREQ = 700;
  const DEFAULT_VOL = 0.8;
  const ATTACK = 0.01;          // rise/fall time ของโทน กันเสียงแตก

  let freq = DEFAULT_FREQ;
  let playVersion = 0;          // เพิ่มทุกครั้งที่เล่น/หยุด เพื่อยกเลิกการเล่นที่ยังไม่ได้เริ่ม
  let active = null;            // { tokens, chars, endTime, curIdx } ของรอบที่กำลังเล่น
  let liveUnitMs = null;        // ค่าความเร็วล่าสุดที่ปรับระหว่างเล่น

  const START_DELAY = 0.05;     // หน่วงเริ่มโทนแรกสั้นลง (เดิม 0.1s)

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;    // กันคลิปเมื่อเสียงเกิน 1.0
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      masterGain = ctx.createGain();
      masterGain.gain.value = DEFAULT_VOL;
      limiter.connect(masterGain);
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setVolume(v) {
    if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  function setFreq(f) {
    freq = Math.max(50, Math.min(2000, f || DEFAULT_FREQ));
    // เปลี่ยนความถี่ทันทีให้โทนที่ยังไม่จบ (ระหว่างเล่น)
    if (ctx) {
      for (const s of scheduled) {
        if (s.osc && s.gain) {
          try { s.osc.frequency.value = freq; } catch (e) {}
        }
      }
    }
  }

  function tone(startTime, durSec) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.exponentialRampToValueAtTime(1, startTime + ATTACK);
    g.gain.setValueAtTime(1, startTime + durSec - ATTACK);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + durSec);
    osc.connect(g);
    g.connect(limiter || masterGain);
    osc.start(startTime);
    osc.stop(startTime + durSec + 0.02);
    return { stopTime: startTime + durSec + 0.02, gain: g, osc };
  }

  // tokens: array of {type:'char'|'space'|'skip', char, code, index}
  // Returns { elems: [{t,dur,type}], chars: [{tokenIndex,start,end}], endTime }
  function buildTimeline(tokens, unitMs, baseTime) {
    const unit = unitMs / 1000;
    const elems = [];
    const chars = [];
    let t = (baseTime !== undefined) ? baseTime : ctx.currentTime + START_DELAY;
    for (const tk of tokens) {
      if (tk.type === 'gap') {
        t += (tk.units || 0) * unit;   // เว้นช่องตามจำนวนหน่วยที่ระบุ
        continue;
      }
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

  // รอให้ AudioContext ทำงานจริงก่อนค่อยจัดตารางเสียง
  // กันกรณี iOS ที่ state เป็น suspended แล้วเสียงทั้งหมดเลื่อน/ยิงพร้อมกัน
  function play(tokens, unitMs, onChar) {
    stop();
    const c = ensureCtx();
    const v = ++playVersion;
    const ready = c.state === 'running'
      ? Promise.resolve()
      : c.resume().catch(function () {});
    return ready.then(function () {
      if (v !== playVersion) return 0;
      return schedulePlay(c, tokens, unitMs, onChar);
    });
  }

  function schedulePlay(c, tokens, unitMs, onChar) {
    const u = liveUnitMs !== null ? liveUnitMs : unitMs;
    const { elems, chars, endTime } = buildTimeline(tokens, u, c.currentTime + START_DELAY);
    if (elems.length === 0) return 0;
    for (const e of elems) {
      scheduled.push(tone(e.t, e.dur));
    }
    playing = true;
    onCharCallback = onChar || null;
    active = { tokens: tokens, chars: chars, endTime: endTime, curIdx: -1 };

    let curIdx = -1;
    const look = setInterval(function () {
      if (!playing || !active) return;
      const now = c.currentTime;
      const chars = active.chars;
      let idx = -1;
      for (let i = 0; i < chars.length; i++) {
        if (now >= chars[i].start && now < chars[i].end) { idx = chars[i].tokenIndex; break; }
      }
      active.curIdx = idx;
      if (idx !== curIdx) {
        curIdx = idx;
        if (onCharCallback) onCharCallback(idx);
      }
      if (now >= active.endTime) stop();
    }, 30);
    scheduled.push({ look });

    const checkEnd = function () {
      if (!playing) return;
      if (c.currentTime >= active.endTime) stop();
      else setTimeout(checkEnd, 50);
    };
    scheduled.push({ callback: checkEnd });
    return (active.endTime - c.currentTime) * 1000;
  }

  // ยกเลิกโทนที่ค้างไว้ แต่คง interval ตรวจจับไฮไลต์/จบไว้
  function cancelTones() {
    const now = ctx ? ctx.currentTime : 0;
    const keep = [];
    for (const s of scheduled) {
      if (s.osc && s.gain) {
        try {
          s.gain.gain.cancelScheduledValues(now);
          s.gain.gain.setValueAtTime(s.gain.gain.value, now);
          s.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);
          s.osc.stop(now + 0.02);
        } catch (e) {}
      } else {
        keep.push(s);
      }
    }
    scheduled = keep;
  }

  // ปรับความเร็วกลางคัน: จัดตารางใหม่จากตำแหน่งที่กำลังเล่นด้วยค่าใหม่
  function retime(unitMs) {
    liveUnitMs = unitMs;
    if (!playing || !active) return;
    const c = ctx;
    let startArr = 0;
    if (active.curIdx >= 0) {
      const toks = active.tokens;
      for (let i = 0; i < toks.length; i++) {
        if (toks[i].index === active.curIdx) { startArr = i; break; }
      }
    }
    const remTokens = active.tokens.slice(startArr);
    if (remTokens.length === 0) return;
    cancelTones();
    const base = c.currentTime + START_DELAY;
    const { elems, chars, endTime } = buildTimeline(remTokens, unitMs, base);
    if (elems.length === 0) { stop(); return; }
    for (const e of elems) {
      scheduled.push(tone(e.t, e.dur));
    }
    active.tokens = remTokens;
    active.chars = chars;
    active.endTime = endTime;
    active.curIdx = -1;
    if (onCharCallback) onCharCallback(-1);
  }

  function stop() {
    playVersion++;
    playing = false;
    active = null;
    const now = ctx ? ctx.currentTime : 0;
    for (const s of scheduled) {
      if (s.gain) {
        try {
          s.gain.gain.cancelScheduledValues(now);
          s.gain.gain.setValueAtTime(s.gain.gain.value, now);
          s.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);
        } catch (e) {}
      }
      if (s.osc) { try { s.osc.stop(now + 0.02); } catch (e) {} }
      if (s.look) clearInterval(s.look);
      if (s.callback) clearTimeout(s.callback);
    }
    scheduled = [];
    if (onCharCallback) { const f = onCharCallback; onCharCallback = null; f(-1); }
    if (onStopCallback) { const f = onStopCallback; onStopCallback = null; f(); }
  }

  function isPlaying() { return playing; }
  function onStop(fn) { onStopCallback = fn; }
  function compressorTarget() { return limiter || masterGain; }

  return { play, stop, setVolume, setFreq, retime, isPlaying, onStop, ensureCtx, compressorTarget, DEFAULT_UNIT_MS, DEFAULT_FREQ };
})();
