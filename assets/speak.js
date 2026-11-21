/* 발음 연습: 원어민(기기 TTS) 듣기 · 내 목소리 녹음 · 비교 · 단어별 판정 · 백업
   녹음은 이 기기의 IndexedDB 에만 저장된다. */
(function () {
  'use strict';

  /* ---------- 공통 ---------- */
  const LANGS = { EN: 'en-US', JP: 'ja-JP', DE: 'de-DE', FR: 'fr-FR' };
  const $ = (id) => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }
  window.toast = toast;

  /* ---------- 억양(미국/영국) ---------- */
  let accent = lsGet('poly_accent', 'US') === 'UK' ? 'UK' : 'US';
  function langCode() {
    if (curL === 'EN') return accent === 'UK' ? 'en-GB' : 'en-US';
    return LANGS[curL] || 'en-US';
  }
  function updateAccentUI() {
    ['accent-btn', 'sp-accent'].forEach((id) => {
      const b = $(id); if (!b) return;
      b.textContent = accent === 'UK' ? '🇬🇧 UK' : '🇺🇸 US';
      b.style.visibility = curL === 'EN' ? 'visible' : 'hidden';
      b.style.color = accent === 'UK' ? '#4f46e5' : '';
    });
  }
  window.updateAccentUI = updateAccentUI;
  window.toggleAccent = function () {
    accent = accent === 'US' ? 'UK' : 'US';
    lsSet('poly_accent', accent);
    updateAccentUI();
    if (!pickVoice(langCode()) && voicesLoaded) {
      toast(accent === 'UK' ? '영국 영어 음성이 없어요. 설정 → 텍스트 음성 변환에서 English (UK)를 받아 주세요' : '미국 영어 음성을 찾지 못했어요', 4200);
    }
  };

  /* ---------- TTS ---------- */
  let voices = [], voicesLoaded = false;
  function loadVoices() {
    if (!window.speechSynthesis) return;
    voices = speechSynthesis.getVoices() || [];
    if (voices.length) voicesLoaded = true;
  }
  if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }
  function norm(l) { return String(l || '').replace('_', '-').toLowerCase(); }
  function pickVoice(code) {
    const c = norm(code);
    const exact = voices.filter((v) => norm(v.lang) === c);
    if (!exact.length) return null;
    // 오프라인에서도 되는 기기 음성을 우선
    return exact.find((v) => v.localService) || exact[0];
  }

  let nativeMs = 0;
  /* text 를 읽고, 끝나면 resolve(걸린 ms) */
  function speak(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { toast('이 브라우저는 음성 읽기를 지원하지 않아요'); resolve(0); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const code = langCode();
      u.lang = code;
      const v = pickVoice(code);
      if (v) u.voice = v;
      let t0 = 0, done = false;
      const finish = () => { if (done) return; done = true; const ms = t0 ? Date.now() - t0 : 0; if (ms > 200) nativeMs = ms; resolve(ms); };
      u.onstart = () => { t0 = Date.now(); };
      u.onend = finish; u.onerror = finish;
      speechSynthesis.speak(u);
      setTimeout(finish, 20000);
    });
  }
  window.speak = speak;

  /* ---------- 녹음 저장소 (IndexedDB) ---------- */
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('poly_voice', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('rec', { keyPath: 'key' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return idb().then((d) => new Promise((res, rej) => {
      const t = d.transaction('rec', mode); const st = t.objectStore('rec');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    }));
  }
  const recKey = (l, text) => l + '|' + text;
  const recGet = (k) => tx('readonly', (s) => s.get(k));
  const recPut = (o) => tx('readwrite', (s) => s.put(o));
  const recAll = () => tx('readonly', (s) => s.getAll());
  const recDel = (k) => tx('readwrite', (s) => s.delete(k)).catch(() => { });
  window.recKey = recKey; window.recDel = recDel;

  /* ---------- 연습 모달 ---------- */
  let target = '', mine = null, mineUrl = null, mineMs = 0;
  function setMine(rec) {
    if (mineUrl) { URL.revokeObjectURL(mineUrl); mineUrl = null; }
    mine = rec ? rec.blob : null; mineMs = rec ? rec.ms || 0 : 0;
    if (mine) mineUrl = URL.createObjectURL(mine);
    drawWave(mine);
    showDur();
    if (rec && rec.judge) showJudge(rec.judge.heard, false); else { $('sp-score').textContent = ''; $('sp-target').textContent = target; }
  }
  function showDur() {
    const f = (ms) => (ms / 1000).toFixed(1) + '초';
    const parts = [];
    if (nativeMs) parts.push('원어민 ' + f(nativeMs));
    if (mineMs) parts.push('나 ' + f(mineMs));
    $('sp-dur').textContent = parts.join(' · ');
  }

  window.openSpeak = function (e) {
    if (e) e.stopPropagation();
    if (curI === -1) return;
    target = db[curL][curI].e;
    nativeMs = 0;
    $('overlay').classList.remove('hidden');
    ['m-add', 'm-list'].forEach((id) => $(id).classList.add('hidden'));
    $('m-speak').classList.remove('hidden');
    $('sp-target').textContent = target;
    $('sp-msg').textContent = '';
    $('sp-judge').checked = judgeOn();
    showJudgeOnly(judgeOn());
    updateAccentUI();
    setMine(null);
    recGet(recKey(curL, target)).then((r) => { if (r) setMine(r); }).catch(() => { });
  };
  window.closeSpeak = function () {
    if (recording) stopRec();
    stopAudio();
    if (window.speechSynthesis) speechSynthesis.cancel();
    $('m-speak').classList.add('hidden');
    $('overlay').classList.add('hidden');
  };

  /* ---------- 재생 ---------- */
  let audio = null;
  function stopAudio() { if (audio) { audio.pause(); audio = null; } }
  function playBlob() {
    return new Promise((res) => {
      if (!mineUrl) { toast('먼저 녹음해 주세요'); res(); return; }
      stopAudio();
      audio = new Audio(mineUrl);
      audio.onended = () => res(); audio.onerror = () => res();
      audio.play().catch(() => res());
    });
  }
  window.playNative = function () { stopAudio(); speak(target).then(showDur); };
  window.playMine = function () { if (window.speechSynthesis) speechSynthesis.cancel(); playBlob(); };
  window.playBoth = function () {
    if (!mineUrl) { toast('먼저 녹음해 주세요'); return; }
    stopAudio();
    speak(target).then(() => { showDur(); return new Promise((r) => setTimeout(r, 350)); }).then(playBlob);
  };

  /* ---------- 녹음 ---------- */
  let recording = false, mr = null, stream = null, chunks = [], recT0 = 0, recog = null, heard = '', recogErr = '';
  window.toggleRec = function () { recording ? stopRec() : startRec(); };

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { $('sp-msg').textContent = '이 브라우저에서는 녹음을 할 수 없어요.'; return; }
    stopAudio(); if (window.speechSynthesis) speechSynthesis.cancel();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      stream = s; chunks = [];
      const mime = pickMime();
      mr = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = onRecStop;
      mr.start();
      recT0 = Date.now(); recording = true;
      $('sp-rec').textContent = '■ 녹음 끝내기';
      $('sp-rec').classList.replace('bg-indigo-600', 'bg-red-500');
      $('sp-msg').textContent = '문장을 읽어 주세요';
      if (judgeOn()) startRecog();
      autoStop = setTimeout(() => { if (recording) stopRec(); }, 15000);
    }).catch(() => {
      $('sp-msg').textContent = '마이크를 켤 수 없어요. 주소창 왼쪽 아이콘 → 권한에서 마이크를 허용해 주세요.';
    });
  }
  let autoStop = null;
  function stopRec() {
    clearTimeout(autoStop);
    recording = false;
    $('sp-rec').textContent = '● 다시 녹음';
    $('sp-rec').classList.replace('bg-red-500', 'bg-indigo-600');
    mineMs = Date.now() - recT0;
    try { if (mr && mr.state !== 'inactive') mr.stop(); } catch (e) { }
    if (recog) { try { recog.stop(); } catch (e) { } }
  }
  // 인식이 완전히 끝날 때까지(최대 ms) 기다린다
  function waitRecog(ms) {
    return new Promise((res) => {
      if (!recogDone) { res(); return; }
      let fin = false; const end = () => { if (!fin) { fin = true; res(); } };
      recogDone.then(end); setTimeout(end, ms);
    });
  }
  function onRecStop() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const blob = new Blob(chunks, { type: (mr && mr.mimeType) || 'audio/webm' });
    if (blob.size < 500) { $('sp-msg').textContent = '녹음이 너무 짧아요. 다시 해 주세요.'; return; }
    const rec = { key: recKey(curL, target), lang: curL, text: target, blob, ms: mineMs, at: Date.now() };
    setMine(rec);
    $('sp-msg').textContent = judgeOn() ? '판정 중…' : '';
    // 음성 인식 결과는 조금 늦게 올 수 있음
    const save = () => recPut(rec).catch(() => toast('녹음을 저장하지 못했어요'));
    if (judgeOn()) {
      waitRecog(5000).then(() => {
        const got = heard || interim;
        if (got) { rec.judge = { heard: got }; showJudge(got, true); }
        else {
          $('sp-msg').textContent = (recogErr || '이 기기는 녹음과 판정을 동시에 못 하는 것 같아요.') + '\n아래 [🗣 판정만 하기]를 누르고 한 번 더 읽어 주세요.';
          showJudgeOnly(true);
        }
        save();
      });
    } else { save(); }
  }

  /* ---------- 단어별 자동 판정 (Web Speech 인식, 온라인) ---------- */
  function judgeOn() { return lsGet('poly_judge', '0') === '1'; }
  window.setJudge = function (on) {
    if (on && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      $('sp-judge').checked = false;
      toast('이 브라우저는 음성 인식을 지원하지 않아요 (Chrome 권장)', 3500);
      return;
    }
    lsSet('poly_judge', on ? '1' : '0');
    showJudgeOnly(on);
    if (on && !navigator.onLine) toast('지금은 오프라인이라 판정이 안 될 수 있어요', 3000);
  };
  let interim = '', recogDone = null;
  function startRecog(onFinish) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    heard = ''; interim = ''; recogErr = ''; recogDone = null;
    if (!SR) return;
    try {
      recog = new SR();
      recog.lang = langCode();
      recog.interimResults = true;   // 중간 결과도 받아 둔다 (늦게 끝나는 기기 대비)
      recog.maxAlternatives = 1;
      recog.continuous = false;      // 안드로이드에서 continuous 는 불안정
      let resolveDone; recogDone = new Promise((r) => { resolveDone = r; });
      recog.onresult = (ev) => {
        let fin = '', mid = '';
        for (let i = 0; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) fin += ev.results[i][0].transcript + ' ';
          else mid += ev.results[i][0].transcript + ' ';
        }
        if (fin.trim()) heard = fin.trim();
        if (mid.trim()) interim = mid.trim();
      };
      const origEnd = () => { recog = null; resolveDone(); if (onFinish) onFinish(); };
      recog.onerror = (ev) => {
        recogErr = ({
          'no-speech': '말소리가 인식되지 않았어요.',
          'audio-capture': '이 기기에서는 녹음과 판정을 동시에 못 해요.',
          'not-allowed': '음성 인식 권한이 거부되었어요.',
          'network': '인터넷 연결이 필요해요.'
        })[ev.error] || ('판정 오류: ' + ev.error);
      };
      recog.onend = origEnd;
      recog.start();
    } catch (e) { recogErr = '판정을 시작하지 못했어요.'; recogDone = null; }
  }

  // 녹음 없이 판정만 (마이크를 음성 인식 혼자 쓰게 해서 동시 사용 문제를 피함)
  let judging = false;
  function showJudgeOnly(on) { const b = $('sp-judgeonly'); if (b) b.classList.toggle('hidden', !on); }
  window.judgeOnly = function () {
    if (judging || recording) return;
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) { toast('이 브라우저는 음성 인식을 지원하지 않아요'); return; }
    stopAudio(); if (window.speechSynthesis) speechSynthesis.cancel();
    judging = true;
    const b = $('sp-judgeonly'); b.textContent = '듣고 있어요… 문장을 읽어 주세요';
    $('sp-msg').textContent = '';
    startRecog(() => {
      judging = false; b.textContent = '🗣 판정만 하기';
      const got = heard || interim;
      if (got) {
        showJudge(got, true);
        recGet(recKey(curL, target)).then((r) => { if (r) { r.judge = { heard: got }; recPut(r); } }).catch(() => { });
      } else {
        $('sp-msg').textContent = recogErr || '말소리를 알아듣지 못했어요. 조금 더 크게 읽어 주세요.';
      }
    });
    if (!recogDone) { judging = false; b.textContent = '🗣 판정만 하기'; $('sp-msg').textContent = recogErr; }
  };

  // 비교용 토큰화: 일본어는 글자 단위, 나머지는 단어 단위
  function tokens(str, l) {
    let s = String(str || '').toLowerCase();
    s = s.replace(/[’‘`]/g, "'");
    if (l === 'JP') return Array.from(s.replace(/[\s、。！？!?,.「」〜~ー・]/g, ''));
    // 아포스트로피는 무시 (don't = dont)
    return s.replace(/'/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean);
  }
  // 최장 공통 부분수열로 맞은 위치 찾기
  function lcsMatch(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ok = new Array(n).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ok[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return ok;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function showJudge(heardText, fresh) {
    const l = curL;
    const tgt = tokens(target, l), got = tokens(heardText, l);
    if (!tgt.length) return;
    const ok = lcsMatch(tgt, got);
    const pct = Math.round(ok.filter(Boolean).length / tgt.length * 100);
    // 원문 표기를 유지하면서 색칠
    let html = '';
    if (l === 'JP') {
      let k = 0;
      for (const ch of Array.from(target)) {
        if (/[\s、。！？!?,.「」〜~ー・]/.test(ch)) { html += esc(ch); continue; }
        html += '<span style="color:' + (ok[k] ? '#16a34a' : '#ef4444') + '">' + esc(ch) + '</span>'; k++;
      }
    } else {
      let k = 0;
      html = target.split(/(\s+)/).map((part) => {
        if (/^\s+$/.test(part) || !part) return part;
        const w = tokens(part, l);
        if (!w.length) return esc(part);
        const good = w.every(() => ok[k++]);
        return '<span style="color:' + (good ? '#16a34a' : '#ef4444') + '">' + esc(part) + '</span>';
      }).join('');
    }
    $('sp-target').innerHTML = html;
    $('sp-score').textContent = '일치 ' + pct + '%  ·  들린 문장: "' + heardText + '"';
    if (fresh) $('sp-msg').textContent = pct >= 90 ? '좋아요! 거의 정확하게 들렸어요 👏' : '빨간 단어를 원어민 발음과 번갈아 들어 보세요';
  }

  /* ---------- 파형 ---------- */
  function drawWave(blob) {
    const cv = $('sp-wave'); if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 48;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    g.fillStyle = '#cbd5e1'; g.fillRect(0, h / 2 - 0.5, w, 1);
    if (!blob) return;
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    blob.arrayBuffer().then((ab) => {
      const ac = new Ctx();
      return ac.decodeAudioData(ab).then((buf) => { ac.close(); return buf; }, (e) => { ac.close(); throw e; });
    }).then((buf) => {
      if (!mineMs) { mineMs = Math.round(buf.duration * 1000); showDur(); }
      const d = buf.getChannelData(0), bars = Math.floor(w / 3), step = Math.max(1, Math.floor(d.length / bars));
      let peaks = [], max = 0.0001;
      for (let i = 0; i < bars; i++) { let p = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) { const v = Math.abs(d[j]); if (v > p) p = v; } peaks.push(p); if (p > max) max = p; }
      g.clearRect(0, 0, w, h); g.fillStyle = '#4f46e5';
      peaks.forEach((p, i) => { const bh = Math.max(1, (p / max) * (h - 4)); g.fillRect(i * 3, (h - bh) / 2, 2, bh); });
    }).catch(() => { });
  }

  /* ---------- 백업 ---------- */
  function blobToB64(b) { return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
  function b64ToBlob(u) { return fetch(u).then((r) => r.blob()); }
  window.exportBackup = function () {
    recAll().catch(() => []).then((recs) => Promise.all((recs || []).map((r) => blobToB64(r.blob).then((data) => ({ key: r.key, lang: r.lang, text: r.text, ms: r.ms, at: r.at, judge: r.judge, data })))))
      .then((recs) => {
        const out = { app: 'polyglot', version: 1, exportedAt: new Date().toISOString(), cards: db, accent, recordings: recs };
        const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
        const a = document.createElement('a');
        const d = new Date(); const p = (n) => String(n).padStart(2, '0');
        a.href = URL.createObjectURL(blob);
        a.download = 'polyglot-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('백업 파일을 저장했어요 (녹음 ' + recs.length + '개 포함)');
      });
  };
  window.importBackup = function (input) {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    f.text().then((t) => {
      const j = JSON.parse(t);
      // 예전 형식(카드만 저장한 JSON)도 받아준다
      const cards = j && j.cards ? j.cards : j;
      if (!cards || typeof cards !== 'object' || !Object.keys(LANGS).some((l) => Array.isArray(cards[l]))) throw new Error('형식');
      if (!confirm('지금 카드를 백업 파일 내용으로 바꿀까요?')) return;
      Object.keys(LANGS).forEach((l) => { if (Array.isArray(cards[l])) db[l] = cards[l]; });
      save();
      const recs = (j && j.recordings) || [];
      return Promise.all(recs.map((r) => b64ToBlob(r.data).then((blob) => recPut({ key: r.key, lang: r.lang, text: r.text, ms: r.ms, at: r.at, judge: r.judge, blob })))).then(() => {
        toast('복원했어요 (녹음 ' + recs.length + '개)');
        if (typeof renderList === 'function') renderList();
        showNext();
      });
    }).catch(() => toast('백업 파일을 읽지 못했어요', 3000));
  };

  // 브라우저가 저장소를 임의로 지우지 않도록 요청
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
})();
