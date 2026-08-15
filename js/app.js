'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  let unitMs = MorseAudio.DEFAULT_UNIT_MS;
  let volume = 0.8;
  let freq = MorseAudio.DEFAULT_FREQ;
  let timeTimer = null;
  let timeStart = 0;
  let lastRandom = '';
  let tableMode = 'en';
  let stationMode = true;

  // ---------- เจเนอรัล ----------
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }

  function startClock(label) {
    stopClock();
    timeStart = Date.now();
    timeTimer = setInterval(function () {
      $('timeLabel').textContent = 'เวลา ' + formatTime((Date.now() - timeStart) / 1000);
      if (label) $(label).textContent = 'เวลา ' + formatTime((Date.now() - timeStart) / 1000);
    }, 200);
  }
  function stopClock() {
    if (timeTimer) { clearInterval(timeTimer); timeTimer = null; }
  }

  function updateSpeedLabel() {
    const wpm = Math.round(1200 / unitMs);
    const txt = unitMs + ' ms / ' + wpm + ' คำต่อนาที';
    $('unitLabel').textContent = txt;
    $('rndUnitLabel').textContent = txt;
    $('lessonUnitLabel').textContent = txt;
  }
  function updateVolLabel() {
    const txt = Math.round(volume * 100) + '%';
    $('volLabel').textContent = txt;
    $('rndVolLabel').textContent = txt;
    $('lessonVolLabel').textContent = txt;
    $('keyVolLabel').textContent = txt;
  }

  function setUnit(ms) {
    unitMs = ms;
    MorseAudio.retime(ms);
    $('unitRange').value = ms;
    $('rndUnitRange').value = ms;
    $('lessonUnitRange').value = ms;
    updateSpeedLabel();
  }
  function setVol(v) {
    volume = v;
    MorseAudio.setVolume(v);
    $('volRange').value = Math.round(v * 100);
    $('rndVolRange').value = Math.round(v * 100);
    $('lessonVolRange').value = Math.round(v * 100);
    $('keyVolRange').value = Math.round(v * 100);
    updateVolLabel();
  }

  function updateFreqLabel() {
    const txt = freq + ' Hz';
    $('freqLabel').textContent = txt;
    $('rndFreqLabel').textContent = txt;
    $('lessonFreqLabel').textContent = txt;
    $('keyFreqLabel').textContent = txt;
  }
  function setFreq(f) {
    freq = f;
    MorseAudio.setFreq(f);
    if (keyOsc) { try { keyOsc.frequency.value = f; } catch (e) {} }
    $('freqRange').value = f;
    $('rndFreqRange').value = f;
    $('lessonFreqRange').value = f;
    $('keyFreqRange').value = f;
    updateFreqLabel();
  }

  function renderPreview() {
    const on = $('showMorse').checked;
    const box = $('morsePreview');
    if (!on) { box.classList.add('hidden'); return; }
    const tokens = textToMorse($('playInput').value);
    const out = tokens.map(function (tk) {
      if (tk.type === 'space') return '   ';
      if (tk.type === 'char') return tk.code;
      return '';
    }).join(' ');
    box.textContent = out.trim() || '(ไม่มีข้อความที่แปลงได้)';
    box.classList.remove('hidden');
  }

  // ---------- ตัวแสดงแบบไฮไลต์ ----------
  function buildViewer(container, text) {
    const frag = document.createDocumentFragment();
    const els = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        frag.appendChild(document.createElement('br'));
        els.push(null);
      } else {
        const s = document.createElement('span');
        s.textContent = ch;
        frag.appendChild(s);
        els.push(s);
      }
    }
    container.innerHTML = '';
    container.appendChild(frag);
    return els;
  }

  function setViewerHighlight(container, els, idx) {
    const oldEl = container.querySelector('span.playing');
    if (oldEl) oldEl.classList.remove('playing');
    if (idx >= 0 && els[idx]) {
      els[idx].classList.add('playing');
      try { els[idx].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function setTextareaHighlight(ta, idx) {
    if (idx >= 0 && idx < ta.value.length) ta.setSelectionRange(idx, idx + 1);
    else ta.setSelectionRange(0, 0);
  }

  // ---------- การเล่น ----------
  // ส่งเรียกสถานีแบบเดียวกับโปรแกรมต้นฉบับ 1.6.7:
  //   VVV [9u] = (BT) [9u] ข้อความ [12u] = (BT) [6u] AR
  // ('=' = -...- คือ BT, AR ส่งเป็น อักษร A แล้ว R)
  const INTRO_TOKENS = [
    { type: 'char', char: 'V', code: '...-', index: -1 },
    { type: 'char', char: 'V', code: '...-', index: -1 },
    { type: 'char', char: 'V', code: '...-', index: -1 },
    { type: 'gap', units: 6, index: -1 },
    { type: 'char', char: '=', code: '-...-', index: -1 },
    { type: 'gap', units: 6, index: -1 }
  ];
  const OUTRO_TOKENS = [
    { type: 'gap', units: 9, index: -1 },
    { type: 'char', char: '=', code: '-...-', index: -1 },
    { type: 'gap', units: 3, index: -1 },
    { type: 'char', char: 'A', code: '.-', index: -1 },
    { type: 'char', char: 'R', code: '.-.', index: -1 }
  ];
  function buildPlayTokens(tokens) {
    if (!stationMode) return tokens;
    return INTRO_TOKENS.concat(tokens, OUTRO_TOKENS);
  }

  function playText(text, timeLabel, hl) {
    const tokens = buildPlayTokens(textToMorse(text));
    MorseAudio.stop();
    if (hl && hl.type === 'viewer') {
      const el = hl.el.querySelector('span.playing');
      if (el) el.classList.remove('playing');
    }
    MorseAudio.play(tokens, unitMs, function (idx) {
      if (!hl) return;
      if (hl.type === 'viewer') setViewerHighlight(hl.el, hl.els, idx);
      else if (hl.type === 'textarea') setTextareaHighlight(hl.el, idx);
    }).then(function (dur) {
      if (dur <= 0) {
        if (timeLabel) $(timeLabel).textContent = 'เวลา 00:00';
        else $('timeLabel').textContent = 'เวลา 00:00';
        return;
      }
      startClock(timeLabel);
      MorseAudio.onStop(function () {
        stopClock();
        const l = timeLabel ? $(timeLabel) : $('timeLabel');
        l.textContent = 'เวลา 00:00';
      });
    });
  }

  // ---------- เปิดไฟล์ ----------
  $('btnOpenFile').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      $('playInput').value = e.target.result;
      $('fileNameLabel').textContent = f.name;
      renderPreview();
    };
    reader.readAsText(f, 'utf-8');
    this.value = '';
  });

  // ---------- ปุ่มเล่น/หยุด/ล้าง ----------
  $('btnPlay').addEventListener('click', function () {
    MorseAudio.ensureCtx();
    const ta = $('playInput');
    playText(ta.value, null, { type: 'textarea', el: ta });
    try { ta.focus({ preventScroll: true }); } catch (e) {}
  });
  $('btnStop').addEventListener('click', function () {
    MorseAudio.stop();
    stopClock();
    $('timeLabel').textContent = 'เวลา 00:00';
  });
  $('btnClear').addEventListener('click', function () {
    $('playInput').value = '';
    $('fileNameLabel').textContent = 'ยังไม่ได้เปิดไฟล์';
    renderPreview();
  });
  $('playInput').addEventListener('input', renderPreview);
  $('showMorse').addEventListener('change', renderPreview);
  $('stationMode').addEventListener('change', function () {
    stationMode = this.checked;
  });

  // ---------- สปีด / ความดัง ----------
  $('unitRange').addEventListener('input', function () {
    setUnit(parseInt(this.value, 10));
  });
  $('rndUnitRange').addEventListener('input', function () {
    setUnit(parseInt(this.value, 10));
  });
  $('lessonUnitRange').addEventListener('input', function () {
    setUnit(parseInt(this.value, 10));
  });
  $('volRange').addEventListener('input', function () {
    setVol(parseInt(this.value, 10) / 100);
  });
  $('rndVolRange').addEventListener('input', function () {
    setVol(parseInt(this.value, 10) / 100);
  });
  $('lessonVolRange').addEventListener('input', function () {
    setVol(parseInt(this.value, 10) / 100);
  });
  $('keyVolRange').addEventListener('input', function () {
    setVol(parseInt(this.value, 10) / 100);
  });
  $('freqRange').addEventListener('input', function () {
    setFreq(parseInt(this.value, 10));
  });
  $('rndFreqRange').addEventListener('input', function () {
    setFreq(parseInt(this.value, 10));
  });
  $('lessonFreqRange').addEventListener('input', function () {
    setFreq(parseInt(this.value, 10));
  });
  $('keyFreqRange').addEventListener('input', function () {
    setFreq(parseInt(this.value, 10));
  });

  // ---------- สุ่ม ----------
  let rndEls = [];
  function getText(file) { return TEXT_DATA[file] || ''; }
  function pickLine(text) {
    const lines = text.split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
    if (lines.length === 0) return '';
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function setRandomText(s) {
    lastRandom = s;
    rndEls = buildViewer($('rndView'), s);
    if (!s) $('rndView').innerHTML = '<span class="muted">กดปุ่มสุ่มเพื่อฝึกฟัง</span>';
  }

  function randomThai() { setRandomText(pickLine(getText('thaiText.txt'))); }
  function randomEng() { setRandomText(pickLine(getText('engText.txt'))); }
  function randomDigit() {
    const n = 5 + Math.floor(Math.random() * 5);
    let s = '';
    const digits = '123456789';
    for (let i = 0; i < n; i++) s += digits[Math.floor(Math.random() * digits.length)];
    setRandomText(s);
  }
  function randomChar() {
    const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    const n = 1 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) s += pool[Math.floor(Math.random() * pool.length)];
    setRandomText(s);
  }

  $('btnRndThai').addEventListener('click', randomThai);
  $('btnRndEng').addEventListener('click', randomEng);
  $('btnRndDigit').addEventListener('click', randomDigit);
  $('btnRndChar').addEventListener('click', randomChar);
  $('btnRndAgain').addEventListener('click', function () {
    const thaiish = /[\u0E00-\u0E7F]/.test(lastRandom);
    const digitish = /^[0-9*]{3,}$/.test(lastRandom);
    if (digitish) randomDigit();
    else if (thaiish) randomThai();
    else randomEng();
  });
  $('btnRndPlay').addEventListener('click', function () {
    MorseAudio.ensureCtx();
    playText(lastRandom, 'rndTimeLabel', { type: 'viewer', el: $('rndView'), els: rndEls });
  });
  $('btnRndStop').addEventListener('click', function () {
    MorseAudio.stop();
    stopClock();
    $('rndTimeLabel').textContent = 'เวลา 00:00';
  });

  // ---------- บทเรียน ----------
  const lessonSel = $('lessonSelect');
  LESSONS.forEach(function (ls, i) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ls.title;
    lessonSel.appendChild(opt);
  });

  let lessonEls = [];
  function loadLesson() {
    const ls = LESSONS[parseInt(lessonSel.value, 10)];
    lessonEls = buildViewer($('lessonView'), getText(ls.file));
    if (getText(ls.file).trim().length === 0) {
      $('lessonView').innerHTML = '<span class="muted">บทเรียนว่างเปล่า</span>';
    }
  }
  $('btnLoadLesson').addEventListener('click', loadLesson);
  lessonSel.addEventListener('change', loadLesson);
  $('btnLessonPlay').addEventListener('click', function () {
    MorseAudio.ensureCtx();
    playText(getText(LESSONS[parseInt(lessonSel.value, 10)].file), 'lessonTimeLabel',
      { type: 'viewer', el: $('lessonView'), els: lessonEls });
  });
  $('btnLessonStop').addEventListener('click', function () {
    MorseAudio.stop();
    stopClock();
    $('lessonTimeLabel').textContent = 'เวลา 00:00';
  });

  // ---------- ตาราง ----------
  const TH_CATEGORIES = [
    {
      title: 'พยัญชนะ',
      chars: ['ก','ข','ฃ','ค','ฅ','ฆ','ง','จ','ฉ','ช','ฌ','ซ','ญ','ฎ','ฏ','ฐ','ฑ','ฒ','ณ','ด','ต','ถ','ท','ธ','น','บ','ป','ผ','ฝ','พ','ฟ','ภ','ม','ย','ร','ล','ว','ศ','ษ','ส','ห','ฬ','อ','ฮ']
    },
    {
      title: 'สระ',
      chars: ['ะ','า','ิ','ี','ึ','ื','ุ','ู','เ','แ','โ','ใ','ไ','ำ','ฤ','ฦ','ฤๅ']
    },
    {
      title: 'วรรณยุกต์',
      chars: ['่','้','๊','๋']
    },
    {
      title: 'เครื่องหมาย',
      chars: ['ั','็','์','ฯ','ๆ']
    },
    {
      title: 'ตัวเลขไทย',
      chars: ['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙']
    }
  ];
  const EN_CATEGORIES = [
    { title: 'ตัวอักษร', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
    { title: 'ตัวเลข', chars: '0123456789'.split('') },
    {
      title: 'สัญลักษณ์',
      chars: ['.',',','?',"'",'!','/','(',')','&',':',';','=','+','-','_','"','$','@','–','—','−','“','”','‘','’']
    }
  ];

  function buildSection(cat, map, container) {
    const byCode = {};
    cat.chars.forEach(function (k) {
      if (!map[k]) return;
      const code = map[k];
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(k);
    });
    const codes = Object.keys(byCode);
    if (codes.length === 0) return;
    const sec = document.createElement('div');
    sec.className = 'table-section';
    const h = document.createElement('h3');
    h.className = 'table-title';
    h.textContent = cat.title;
    sec.appendChild(h);
    const g = document.createElement('div');
    g.className = 'morse-grid';
    codes.sort(function (a, b) {
      return byCode[a][0].localeCompare(byCode[b][0], 'th');
    });
    codes.forEach(function (code) {
      const cell = document.createElement('div');
      cell.className = 'morse-cell';
      cell.innerHTML = '<span class="char">' + byCode[code].join(',') + '</span><span class="code">' + code + '</span>';
      g.appendChild(cell);
    });
    sec.appendChild(g);
    container.appendChild(sec);
  }

  function buildTable() {
    const grid = $('morseGrid');
    grid.innerHTML = '';
    const map = tableMode === 'en' ? EN_MORSE : TH_MORSE;
    const cats = tableMode === 'en' ? EN_CATEGORIES : TH_CATEGORIES;
    cats.forEach(function (cat) {
      buildSection(cat, map, grid);
    });
  }
  $('btnTableEn').addEventListener('click', function () {
    tableMode = 'en';
    $('btnTableEn').classList.add('active');
    $('btnTableTh').classList.remove('active');
    buildTable();
  });
  $('btnTableTh').addEventListener('click', function () {
    tableMode = 'th';
    $('btnTableTh').classList.add('active');
    $('btnTableEn').classList.remove('active');
    buildTable();
  });

  // ---------- ปุ่มเคาะ (MorseKey) ----------
  const keyBtn = $('morseKeyBtn');
  let keyOsc = null;
  let keyGain = null;
  let keyDownTime = 0;

  function keyStart() {
    const ctx = MorseAudio.ensureCtx();
    if (keyOsc) return;
    keyDownTime = Date.now();
    keyBtn.classList.add('pressed');
    keyBtn.textContent = 'ส่งสัญญาณ...';
    $('keyStatus').textContent = 'ส่งสัญญาณ';
    keyOsc = ctx.createOscillator();
    keyGain = ctx.createGain();
    keyOsc.type = 'sine';
    keyOsc.frequency.value = freq;
    keyGain.gain.value = volume;
    keyOsc.connect(keyGain);
    keyGain.connect(MorseAudio.compressorTarget() || ctx.destination);
    const startTone = function () {
      if (keyOsc) keyOsc.start();
    };
    if (ctx.state === 'running') startTone();
    else ctx.resume().then(startTone);
  }
  function keyEnd() {
    if (keyOsc && keyGain) {
      const ctx = MorseAudio.ensureCtx();
      const g = keyGain;
      try {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.01);
        keyOsc.stop(now + 0.02);
      } catch (e) {}
      keyOsc = null;
      keyGain = null;
    }
    keyBtn.classList.remove('pressed');
    keyBtn.textContent = 'กดค้างเพื่อส่งสัญญาณ';
    const dur = Date.now() - keyDownTime;
    $('keyStatus').textContent = dur + ' ms' + (dur < 200 ? ' (จุด)' : ' (เส้น)');
  }
  keyBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); keyStart(); });
  keyBtn.addEventListener('pointerup', keyEnd);
  keyBtn.addEventListener('pointercancel', keyEnd);
  keyBtn.addEventListener('pointerleave', keyEnd);

  // ---------- Tabs ----------
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-table') buildTable();
    });
  });

  // ---------- About modal ----------
  $('btnAbout').addEventListener('click', function () { $('modal').classList.remove('hidden'); });
  $('btnModalClose').addEventListener('click', function () { $('modal').classList.add('hidden'); });
  $('modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.add('hidden');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('modal').classList.add('hidden');
  });

  // ---------- Init ----------
  MorseAudio.setVolume(volume);
  updateSpeedLabel();
  updateVolLabel();
  setFreq(freq);
  buildTable();
  loadLesson();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
