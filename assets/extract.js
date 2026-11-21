/* 표현 추출: 유튜브·글 주소 또는 원문 → 자주 쓰는 표현 → 카드 저장
   방법 1) Gemini API (내 키, 이 기기에만 저장)  방법 2) 채팅(Claude/Gemini)용 프롬프트 복사 → 결과 붙여넣기 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } };
  const toast = (m, ms) => (window.toast ? window.toast(m, ms) : alert(m));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const LANG_NAME = { EN: 'English', JP: 'Japanese', DE: 'German', FR: 'French' };
  let results = [];

  /* ---------- 입력 판별 ---------- */
  function classify(raw) {
    const t = raw.trim();
    if (/^https?:\/\/\S+$/i.test(t)) {
      if (/(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i.test(t)) return { kind: 'youtube', url: t };
      return { kind: 'url', url: t };
    }
    return { kind: 'text', text: t };
  }

  /* ---------- 프롬프트 ---------- */
  function buildPrompt(src, forChat) {
    const lang = LANG_NAME[curL] || 'English';
    const what = src.kind === 'youtube' ? 'the YouTube video at ' + src.url + ' (use its spoken content / transcript)'
      : src.kind === 'url' ? 'the web page at ' + src.url
        : 'the text below';
    const lines = [
      'You are helping a Korean learner study ' + lang + '.',
      'From ' + what + ', pick 10 to 15 ' + lang + ' expressions that are natural, practical and frequently used in everyday or work conversation',
      '(phrasal verbs, collocations, idioms, useful sentence patterns or short complete sentences). Skip proper nouns and trivially basic words.',
      'Prefer expressions that actually appear in the source. Keep each expression short enough for a flashcard.',
      '',
      'Return ONLY a JSON array, no markdown, no explanation. Each item:',
      '{"e": "<' + lang + ' expression>", "k": "<natural Korean meaning>", "ex": "<one ' + lang + ' example sentence, from the source if possible>"}'
    ];
    if (forChat) lines.push('', 'Wrap the JSON array in a single code block so it is easy to copy.');
    if (src.kind === 'text') lines.push('', '--- TEXT ---', src.text.slice(0, 60000));
    return lines.join('\n');
  }

  /* ---------- 결과 파싱 (채팅 결과에 설명/코드블록이 섞여도 처리) ---------- */
  function parseItems(txt) {
    if (!txt) return [];
    let s = String(txt).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    let arr = null;
    try { arr = JSON.parse(s); } catch (e) {
      const a = s.indexOf('['), b = s.lastIndexOf(']');
      if (a >= 0 && b > a) { try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e2) { } }
    }
    if (arr && !Array.isArray(arr)) arr = arr.items || arr.expressions || arr.cards || null;
    if (!Array.isArray(arr)) {
      // JSON 이 아니면 "표현 - 뜻" 줄 단위로 시도
      arr = s.split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '')).map((l) => l.split(/\s+[-–—:|]\s+/)).filter((p) => p.length >= 2).map((p) => ({ e: p[0], k: p[1], ex: p[2] || '' }));
    }
    return arr.map((it) => ({
      e: String(it.e || it.expression || it.phrase || '').trim(),
      k: String(it.k || it.meaning || it.korean || '').trim(),
      ex: String(it.ex || it.example || '').trim()
    })).filter((it) => it.e && it.k).slice(0, 40);
  }

  /* ---------- Gemini ---------- */
  function key() { return lsGet('poly_gemini_key', ''); }

  // 키로 쓸 수 있는 모델 목록을 조회해서 텍스트용 flash 계열 중 최신을 고른다 (모델 이름이 바뀌어도 동작)
  async function pickModel(force) {
    const saved = lsGet('poly_gemini_model', '');
    if (saved && !force) return saved;
    const r = await fetch(API + '/models?pageSize=200', { headers: { 'x-goog-api-key': key() } });
    if (!r.ok) throw await apiError(r);
    const j = await r.json();
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-/.test(n) && !/(image|tts|audio|live|embed|vision|thinking|exp|preview|learnlm|robotics|computer)/i.test(n));
    const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const score = (n) => ver(n) * 100 + (/flash/.test(n) && !/lite/.test(n) ? 20 : /flash-lite/.test(n) ? 10 : /pro/.test(n) ? 5 : 0) + (/latest/.test(n) ? 1 : 0) - (/\d{3,}$/.test(n) ? 0.5 : 0);
    names.sort((a, b) => score(b) - score(a));
    if (!names.length) throw new Error('사용할 수 있는 Gemini 모델을 찾지 못했어요.');
    lsSet('poly_gemini_model', names[0]);
    lsSet('poly_gemini_models', JSON.stringify(names.slice(0, 6)));
    return names[0];
  }

  async function apiError(r) {
    let msg = '', details = [];
    try { const j = await r.json(); msg = (j.error && j.error.message) || ''; details = (j.error && j.error.details) || []; } catch (e) { }
    if (r.status === 400 && /api key/i.test(msg)) return new Error('API 키가 올바르지 않아요. 설정에서 다시 확인해 주세요.');
    if (r.status === 403) return new Error('API 키 권한이 없어요. (키 제한 설정이나 결제 상태를 확인해 주세요)');
    if (r.status === 503 || r.status === 500 || /high demand|overloaded|unavailable/i.test(msg)) { const e = new Error('Gemini 서버가 지금 혼잡해요. 잠시 뒤 다시 하거나 [📋 채팅으로 하기]를 써 주세요.'); e.status = r.status || 503; e.busy = true; return e; }
    if (r.status === 429) {
      // 하루 한도인지 1분 한도인지 구분해서 언제 다시 되는지 알려준다
      const blob = msg + ' ' + JSON.stringify(details);
      const daily = /per.?day|PerDay|daily/i.test(blob);
      const ri = details.find((d) => d && d.retryDelay);
      const sec = ri ? parseInt(String(ri.retryDelay), 10) : 0;
      const when = daily ? '하루 무료 한도를 다 썼어요. 한국 시간 오후 4~5시쯤 초기화돼요.'
        : '1분 무료 한도를 넘었어요. ' + (sec ? sec + '초 뒤' : '1분 뒤') + ' 다시 해 주세요.';
      const e = new Error(when + '\n👉 지금 바로 하려면 [📋 채팅으로 하기]를 써 주세요.'); e.status = 429; e.daily = daily; return e;
    }
    const e = new Error((msg || ('오류 ' + r.status)).slice(0, 200)); e.status = r.status; return e;
  }

  let ctrl = null;   // 진행 중인 요청 (CLOSE 하면 취소)
  async function callGemini(model, body, timeoutMs) {
    ctrl = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs || 60000);
    let r;
    try {
      r = await fetch(API + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(body), signal: ctrl.signal
      });
    } catch (e) {
      const err = new Error(timedOut ? '너무 오래 걸려서 멈췄어요.' : '취소했어요.');
      err.timeout = timedOut; err.cancelled = !timedOut; throw err;
    } finally { clearTimeout(t); }
    if (!r.ok) throw await apiError(r);
    const j = await r.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map((p) => p.text || '').join('');
    if (!text) {
      const why = (j.promptFeedback && j.promptFeedback.blockReason) || (((j.candidates || [])[0] || {}).finishReason) || '';
      throw new Error('응답이 비어 있어요' + (why ? ' (' + why + ')' : '') + '.');
    }
    return text;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function candidates(first) {
    let list = [];
    try { list = JSON.parse(lsGet('poly_gemini_models', '[]')) || []; } catch (e) { }
    return [first].concat(list.filter((m) => m !== first)).slice(0, 4);
  }
  async function extractWithGemini(src) {
    // 예전 버전에서 연결한 경우 예비 모델 목록이 없으므로 새로 받아 둔다
    const first = lsGet('poly_gemini_models', '') ? await pickModel(false) : await pickModel(true);
    const prompt = buildPrompt(src, false);
    const yt = src.kind === 'youtube';
    const plain = (parts) => ({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.4 } });
    let body;
    if (yt) {
      // 영상은 무겁다: 앞 10분만, 저화질로 보게 해서 처리량을 1/3 수준으로 줄인다 (말소리는 그대로)
      body = plain([{ fileData: { fileUri: src.url }, videoMetadata: { startOffset: '0s', endOffset: '600s' } }, { text: prompt }]);
      body.generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
      body.generationConfig.responseMimeType = 'application/json';
    } else {
      body = plain([{ text: prompt }]);
      if (src.kind === 'url') body.tools = [{ url_context: {} }];      // 웹 글 주소를 직접 읽게 함
      else body.generationConfig.responseMimeType = 'application/json';
    }
    const timeout = yt ? 100000 : 60000;
    // 영상은 오래 걸리니 모델 2개까지만, 같은 모델 재시도 없이. 글은 혼잡하면 한 번 기다렸다 재시도.
    const models = candidates(first).slice(0, yt ? 2 : 4);
    let lastErr = null, simplified = false;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const tries = (!yt && i === 0) ? 2 : 1;
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          if (i > 0) busyLabel('혼잡해서 다른 모델로 시도 중');
          else if (attempt > 0) busyLabel('혼잡해서 다시 시도 중');
          return await callGemini(model, body, timeout);
        } catch (e) {
          lastErr = e;
          if (e.cancelled) throw e;
          // 영상 옵션(구간·저화질)을 지원하지 않는 모델이면 기본 방식으로 한 번 더
          if (yt && e.status === 400 && !simplified) {
            simplified = true;
            body = plain([{ fileData: { fileUri: src.url } }, { text: prompt }]);
            attempt--; continue;
          }
          if (e.status === 404) break;
          if (e.status === 429 && e.daily) { i = models.length; break; }
          if (e.status === 429) break;                     // 1분 한도는 모델별 → 같은 모델 재시도 없이 다음 모델
          if (e.busy || e.status === 429 || e.timeout) { if (!yt && attempt === 0 && i === 0) await sleep(2500); continue; }
          i = models.length; break;
        }
      }
    }
    const e = lastErr || new Error('추출하지 못했어요.');
    if (e.status === 404) { lsSet('poly_gemini_model', null); throw new Error('모델 목록이 바뀌었어요. 한 번 더 눌러 주세요.'); }
    if (yt) {
      const why = e.timeout ? '영상 분석이 너무 오래 걸려요.' : e.busy || e.status === 429 ? 'Gemini 서버가 지금 혼잡해요.' : e.status === 400 ? '이 영상을 읽지 못했어요 (비공개·연령제한 등).' : (e.message || '영상을 처리하지 못했어요.');
      const err = new Error(why + '\n👉 [📋 채팅으로 하기]를 누르고 Gemini 앱에 붙여넣으면 영상을 직접 보고 추출해 줘요.\n👉 또는 유튜브 [스크립트 표시]의 자막을 복사해 붙여넣어 주세요.');
      throw err;
    }
    if (src.kind === 'url' && e.status === 400) throw new Error('이 페이지를 읽지 못했어요. 글 내용을 복사해 붙여넣어 주세요.');
    throw e;
  }

  /* ---------- 화면 ---------- */
  window.openFind = function () {
    $('overlay').classList.remove('hidden');
    ['m-add', 'm-list', 'm-speak'].forEach((id) => { const el = $(id); if (el) el.classList.add('hidden'); });
    $('m-find').classList.remove('hidden');
    $('fx-lang').textContent = LANG_NAME[curL] || 'English';
    renderKeyState();
    showStep('input');
  };
  window.closeFind = function () {
    if (ctrl) { try { ctrl.abort(); } catch (e) { } } $('m-find').classList.add('hidden'); $('overlay').classList.add('hidden'); };

  function showStep(s) {
    ['input', 'paste', 'result', 'key'].forEach((x) => $('fx-' + x).classList.toggle('hidden', x !== s));
  }
  window.fxStep = showStep;

  function renderKeyState() {
    const k = key();
    $('fx-keystate').textContent = k ? 'Gemini ✓' : 'Gemini 키 없음';
    $('fx-keystate').title = lsGet('poly_gemini_model', '');
    $('fx-go').textContent = isYoutube() ? '▶ Gemini 앱에서 추출하기 (무료)' : k ? '✨ 표현 추출하기' : '✨ Gemini 연결하고 추출하기';
  }

  let busyText = '', busyT0 = 0, busyTimer = null;
  function paintBusy() { $('fx-go').textContent = busyText + ' · ' + Math.round((Date.now() - busyT0) / 1000) + '초'; }
  function busyLabel(t) { busyText = t; paintBusy(); }
  function setBusy(on, msg) {
    const b = $('fx-go'); b.disabled = on; b.style.opacity = on ? '0.6' : '';
    clearInterval(busyTimer); busyTimer = null;
    if (on) { busyText = msg || '추출 중'; busyT0 = Date.now(); paintBusy(); busyTimer = setInterval(paintBusy, 1000); }
    else renderKeyState();
  }
  function setMsg(m) { $('fx-msg').textContent = m || ''; }

  // 유튜브는 API 무료 한도로 감당하기 어려워서 Gemini 앱(무료)으로 보낸다
  function isYoutube() { return classify($('fx-in').value || '').kind === 'youtube'; }
  function viaGeminiApp() {
    const p = buildPrompt(classify($('fx-in').value), true);
    const go = () => {
      showStep('paste');
      toast('프롬프트를 복사했어요. Gemini 앱에 붙여넣고 보내 주세요', 4000);
      window.open('https://gemini.google.com/app', '_blank', 'noopener');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(p).then(go, () => fallbackCopy(p, go));
    else fallbackCopy(p, go);
  }
  window.fxInput = function () { if (!$('fx-go').disabled) renderKeyState(); setMsg(''); };

  window.fxGo = async function () {
    const raw = $('fx-in').value;
    if (!raw.trim()) { setMsg('주소나 원문을 넣어 주세요.'); return; }
    if (isYoutube()) { viaGeminiApp(); return; }
    if (!key()) { showStep('key'); return; }
    if (!navigator.onLine) { setMsg('인터넷 연결이 필요해요.'); return; }
    const src = classify(raw);
    setMsg(''); setBusy(true, src.kind === 'youtube' ? '영상 보는 중 (최대 2~3분)' : '추출 중');
    try {
      const text = await extractWithGemini(src);
      const items = parseItems(text);
      if (!items.length) throw new Error('표현을 찾지 못했어요. 다른 글로 해 보거나 [📋 채팅으로 하기]를 써 주세요.');
      showResults(items, src);
    } catch (e) {
      if (!(e && e.cancelled)) setMsg(e && e.message ? e.message : '추출하지 못했어요.');
    } finally { setBusy(false); }
  };

  window.fxCopyPrompt = function () {
    const raw = $('fx-in').value;
    if (!raw.trim()) { setMsg('주소나 원문을 먼저 넣어 주세요.'); return; }
    const p = buildPrompt(classify(raw), true);
    const done = () => { toast('프롬프트를 복사했어요. Claude나 Gemini 채팅에 붙여넣으세요', 3500); showStep('paste'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(p).then(done, () => fallbackCopy(p, done));
    else fallbackCopy(p, done);
  };
  function fallbackCopy(t, done) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('복사하지 못했어요'); }
    ta.remove();
  }
  window.fxParsePasted = function () {
    const items = parseItems($('fx-paste-in').value);
    if (!items.length) { toast('결과를 읽지 못했어요. 채팅 답변의 JSON 부분을 그대로 붙여넣어 주세요', 3500); return; }
    showResults(items, classify($('fx-in').value || ''));
  };

  function showResults(items, src) {
    const have = new Set((db[curL] || []).map((c) => c.e.trim().toLowerCase()));
    results = items.map((it) => ({ ...it, dup: have.has(it.e.toLowerCase()), on: !have.has(it.e.toLowerCase()), src: src && (src.url || '') }));
    $('fx-list').innerHTML = results.map((it, i) => `
      <label class="flex gap-3 items-start bg-slate-50 p-3 rounded-2xl ${it.dup ? 'opacity-50' : ''}">
        <input type="checkbox" ${it.on ? 'checked' : ''} ${it.dup ? 'disabled' : ''} onchange="fxToggle(${i}, this.checked)" class="mt-1 w-4 h-4 accent-indigo-600 shrink-0">
        <div class="min-w-0 text-left">
          <p class="text-[12px] font-bold text-slate-800">${esc(it.e)}${it.dup ? ' <span class="text-[9px] text-slate-400">이미 있음</span>' : ''}</p>
          <p class="text-[11px] text-slate-500">${esc(it.k)}</p>
          ${it.ex ? `<p class="text-[10px] text-slate-400 italic mt-1">${esc(it.ex)}</p>` : ''}
        </div>
      </label>`).join('');
    updateSaveBtn();
    showStep('result');
  }
  window.fxToggle = function (i, on) { results[i].on = on; updateSaveBtn(); };
  window.fxAll = function () {
    const any = results.some((r) => !r.dup && !r.on);
    results.forEach((r) => { if (!r.dup) r.on = any; });
    document.querySelectorAll('#fx-list input[type=checkbox]:not(:disabled)').forEach((c) => { c.checked = any; });
    updateSaveBtn();
  };
  function updateSaveBtn() {
    const n = results.filter((r) => r.on && !r.dup).length;
    const b = $('fx-save'); b.textContent = n ? '선택한 ' + n + '개 카드에 저장' : '저장할 표현을 골라 주세요'; b.disabled = !n; b.style.opacity = n ? '' : '0.5';
  }
  window.fxSave = function () {
    const pick = results.filter((r) => r.on && !r.dup);
    if (!pick.length) return;
    pick.forEach((r) => db[curL].push({ e: r.e, k: r.k, ex: r.ex || undefined, src: r.src || undefined, w: 10 }));
    save();
    toast(pick.length + '개를 ' + curL + ' 카드에 저장했어요');
    $('fx-in').value = ''; $('fx-paste-in').value = '';
    closeFind();
    showNext();
  };

  /* ---------- 키 설정 ---------- */
  window.fxSaveKey = async function () {
    const k = $('fx-key-in').value.trim();
    if (!k) { toast('키를 붙여넣어 주세요'); return; }
    lsSet('poly_gemini_key', k); lsSet('poly_gemini_model', null);
    const b = $('fx-keysave'); b.textContent = '확인 중…'; b.disabled = true;
    try {
      const m = await pickModel(true);
      toast('연결됐어요 · ' + m);
      $('fx-key-in').value = '';
      renderKeyState(); showStep('input');
    } catch (e) {
      lsSet('poly_gemini_key', null);
      toast(e.message || '키를 확인하지 못했어요', 4000);
    } finally { b.textContent = '저장하고 연결 확인'; b.disabled = false; }
  };
  window.fxRemoveKey = function () {
    if (!confirm('이 기기에서 Gemini 키를 지울까요?')) return;
    lsSet('poly_gemini_key', null); lsSet('poly_gemini_model', null);
    renderKeyState(); toast('키를 지웠어요');
  };

  window.__fx = { parseItems, classify, buildPrompt };
})();
