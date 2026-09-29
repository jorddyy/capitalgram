'use strict';

(() => {
  const STORE_KEY = 'capitalgram:v1';
  const CONTINENTS = ['Europe', 'Africa', 'Asia', 'North America', 'South America', 'Oceania'];
  // Leitner boxes: how long a card rests after landing in box n
  const BOX_WAIT = [45e3, 5 * 60e3, 864e5, 3 * 864e5, 7 * 864e5, 21 * 864e5];
  const LEARNED_BOX = 3;
  const MAX_LEARNING = 5;
  const W = 400, H = 280;
  const SCRABBLE = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pickRandom = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const DEG = 180 / Math.PI;

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- stored state

  const DEFAULT_SETTINGS = {
    regions: CONTINENTS.slice(), direction: 'mixed', style: 'type', mapReveal: 'before',
    anStyle: 'mixed', roundLen: 10, timer: 0, tab: 'learn', sv: 2,
  };

  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === 'object') {
        const settings = { ...DEFAULT_SETTINGS, ...s.settings };
        // v1 defaulted to multiple choice, which turned out too easy
        if (!s.settings || !s.settings.sv) Object.assign(settings, { style: 'type', sv: 2 });
        return { settings, cards: s.cards || {} };
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return { settings: { ...DEFAULT_SETTINGS }, cards: {} };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  // ---------- spaced repetition
  // Card kinds: cc = country -> capital, kc = capital -> country, an = anagram

  const card = (kind, id) => state.cards[kind + ':' + id];

  function grade(kind, id, ok) {
    const key = kind + ':' + id;
    const c = state.cards[key] || { b: 0, d: 0, n: 0, w: 0 };
    if (ok) c.b = c.n === 0 ? 2 : Math.min(c.b + 1, BOX_WAIT.length - 1);
    else { c.b = 0; c.w++; }
    c.n++;
    c.d = Date.now() + BOX_WAIT[c.b];
    state.cards[key] = c;
    save();
  }

  function pickCard(kind, pool, exclude, maxLearning) {
    const now = Date.now();
    const avail = pool.filter((id) => !exclude.has(id));
    const list = avail.length ? avail : pool;
    const seen = list.filter((id) => card(kind, id));
    const due = seen.filter((id) => card(kind, id).d <= now)
      .sort((a, b) => card(kind, a).b - card(kind, b).b || card(kind, a).d - card(kind, b).d);
    if (due.length) return due[0];
    const fresh = list.filter((id) => !card(kind, id));
    const learning = pool.filter((id) => { const c = card(kind, id); return c && c.b < 2; }).length;
    if (fresh.length && learning < maxLearning) return pickRandom(fresh);
    if (seen.length) return seen.sort((a, b) => card(kind, a).d - card(kind, b).d)[0];
    return pickRandom(list);
  }

  function status(id) {
    const cs = [card('cc', id), card('kc', id)].filter(Boolean);
    if (!cs.length) return 'new';
    return Math.max(...cs.map((c) => c.b)) >= LEARNED_BOX ? 'learned' : 'learning';
  }

  // ---------- data

  let COUNTRIES = [], BY_ID = {}, PHRASES = {}, FEATURES = [], GRATICULE;
  const FEATURE_OF = {};
  const NAME_FORMS = new Map(), CAPITAL_FORMS = new Map();

  async function loadData() {
    const urls = ['data/countries.json', 'data/anagrams.json', 'data/countries-50m.json'];
    const [countries, phrases, topo] = await Promise.all(urls.map((u) =>
      fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })));
    COUNTRIES = countries;
    PHRASES = phrases;
    const byIso = {};
    for (const c of countries) {
      BY_ID[c.id] = c;
      if (c.iso) byIso[c.iso] = c.id;
      for (const n of [c.name, ...c.aliases]) NAME_FORMS.set(norm(n), c.id);
      for (const n of [c.capital, ...c.alt]) CAPITAL_FORMS.set(norm(n), c.id);
    }
    FEATURES = topojson.feature(topo, topo.objects.countries).features;
    for (const f of FEATURES) {
      const id = f.id != null ? byIso[f.id] : (f.properties.name === 'Kosovo' ? 'UNK' : null);
      if (id) FEATURE_OF[id] = f;
      f.meta = featureMeta(f);
    }
    GRATICULE = d3.geoGraticule10();
  }

  function polygons(f) {
    const g = f.geometry;
    if (!g) return [];
    return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  }

  function maxDistance(center, rings) {
    let m = 0;
    for (const ring of rings) for (const p of ring) m = Math.max(m, d3.geoDistance(center, p));
    return m;
  }

  // Centre on the largest landmass, so overseas territories (France) and
  // far-flung islands don't zoom the map out to half the planet.
  function featureMeta(f) {
    const polys = polygons(f);
    let main = null, best = -1;
    for (const p of polys) {
      const a = d3.geoArea({ type: 'Polygon', coordinates: p });
      if (a > best) { best = a; main = p; }
    }
    const centroid = d3.geoCentroid(f);
    const mainCenter = main ? d3.geoCentroid({ type: 'Polygon', coordinates: main }) : centroid;
    return {
      centroid,
      extent: maxDistance(centroid, polys.flat()),
      mainCenter,
      mainRadius: main ? maxDistance(mainCenter, main) * DEG : 0,
    };
  }

  // ---------- map

  function drawMap(svg, c, mode) {
    const f = FEATURE_OF[c.id];
    const cap = [c.lon, c.lat];
    let center = f ? f.meta.mainCenter : cap;
    let r = f ? clamp(1.9 * f.meta.mainRadius + 4, 10, 50) : 22;

    if (mode === 'region') {
      // Zoomed out and off-centre, so the hint points at an area, not a country
      r = clamp(r * 1.8 + 8, 24, 60);
      const ang = Math.random() * 2 * Math.PI, off = r * 0.35;
      const lonScale = Math.max(Math.cos(center[1] / DEG), 0.3);
      center = [center[0] + off * Math.cos(ang) / lonScale, clamp(center[1] + off * Math.sin(ang), -75, 75)];
    } else {
      const capDist = d3.geoDistance(center, cap) * DEG;
      if (capDist > r * 0.8) r = Math.min(capDist * 1.25, 80);
    }

    const viewAngle = Math.min(r * 2.2, 170);
    const proj = d3.geoAzimuthalEqualArea().rotate([-center[0], -center[1]]).clipAngle(viewAngle);
    proj.fitExtent([[4, 4], [W - 4, H - 4]], d3.geoCircle().center(center).radius(r)());
    proj.clipExtent([[0, 0], [W, H]]);
    const path = d3.geoPath(proj);
    const limit = viewAngle / DEG;

    let out = `<path class="sea" d="${path({ type: 'Sphere' })}"/><path class="grat" d="${path(GRATICULE) || ''}"/>`;
    let hl = '';
    for (const g of FEATURES) {
      if (d3.geoDistance(center, g.meta.centroid) - g.meta.extent > limit) continue;
      const d = path(g);
      if (!d) continue;
      if (g === f && mode !== 'region') hl = d;
      else out += `<path class="land" d="${d}"/>`;
    }
    if (hl) out += `<path class="land hl" d="${hl}"/>`;

    if (mode !== 'region') {
      const p = proj(cap);
      const small = !f || path.area(f) < 150; // in px²: too small to see without a ring
      if (p && small) out += `<circle class="ring" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="14"/>`;
      if (p) out += `<circle class="cap" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6"/>`;
    }
    svg.innerHTML = out;
  }

  // ---------- answer checking

  function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\bst\.?\s+/g, 'saint ')
      .replace(/^(the|city of)\s+/, '')
      .replace(/[^a-z]/g, '');
  }

  function lettersOf(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '');
  }

  function lev(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // field: 'capital' or 'name'. Returns {ok, exact}.
  function checkAnswer(input, c, field) {
    const a = norm(input);
    if (!a) return { ok: false };
    const accepted = field === 'capital' ? [c.capital, ...c.alt] : [c.name, ...c.aliases];
    if (accepted.some((x) => norm(x) === a)) return { ok: true, exact: true };
    // Another country's real answer is wrong, however close it is (Austria vs Australia)
    const other = (field === 'capital' ? CAPITAL_FORMS : NAME_FORMS).get(a);
    if (other && other !== c.id) return { ok: false };
    for (const x of accepted) {
      const n = norm(x);
      if (/\bcity$/i.test(x) && a === n.replace(/city$/, '')) return { ok: true, exact: false };
      const tolerance = n.length >= 8 ? 2 : n.length >= 4 ? 1 : 0;
      if (lev(a, n) <= tolerance) return { ok: true, exact: false };
    }
    return { ok: false };
  }

  function distractors(c, n) {
    const others = COUNTRIES.filter((o) => o.id !== c.id);
    const tiers = [
      others.filter((o) => o.subregion === c.subregion),
      others.filter((o) => o.continent === c.continent && o.subregion !== c.subregion),
      others.filter((o) => o.continent !== c.continent),
    ];
    const out = [];
    for (const t of tiers) for (const o of shuffle(t)) if (out.length < n) out.push(o);
    return out;
  }

  function poolIds() {
    const regs = state.settings.regions.length ? state.settings.regions : CONTINENTS;
    return COUNTRIES.filter((c) => regs.includes(c.continent)).map((c) => c.id);
  }

  // "the Philippines", "the United Kingdom"
  const THE = /^(Philippines|Netherlands|United |Maldives|Marshall Islands|Solomon Islands|Comoros|Seychelles|Central African|Dominican Republic|Republic of the)/;
  const theName = (c) => (THE.test(c.name) ? 'the ' : '') + c.name;

  function noteHtml(c) {
    return c.note ? `<p class="note">${esc(c.note)}</p>` : '';
  }

  // ---------- Learn

  const learn = { kind: null, id: null, done: false, correct: 0, total: 0 };

  function nextLearn() {
    const dir = state.settings.direction;
    learn.kind = dir === 'mixed' ? (Math.random() < 0.5 ? 'cc' : 'kc') : dir;
    learn.id = pickCard(learn.kind, poolIds(), new Set([learn.id]), MAX_LEARNING);
    learn.done = false;
    renderLearn();
  }

  function renderLearn() {
    const c = BY_ID[learn.id];
    const cc = learn.kind === 'cc';
    const field = cc ? 'capital' : 'name';
    $('learn-eyebrow').textContent = cc ? `${c.continent} · What is the capital of` : `${c.continent} · Which country has the capital`;
    $('learn-question').textContent = cc ? c.name : c.capital;
    $('learn-map').parentElement.classList.toggle('veiled', state.settings.mapReveal === 'after');
    drawMap($('learn-map'), c, 'highlight');
    $('learn-feedback').hidden = true;

    const box = $('learn-answer');
    const style = state.settings.style;
    if (style === 'choice') {
      const opts = shuffle([c, ...distractors(c, 3)]);
      box.innerHTML = `<div class="choices">${opts.map((o) =>
        `<button type="button" class="choice" data-id="${o.id}">${esc(o[field])}</button>`).join('')}</div>`;
      for (const b of box.querySelectorAll('.choice')) {
        b.addEventListener('click', () => {
          if (learn.done) return;
          for (const x of box.querySelectorAll('.choice')) {
            x.disabled = true;
            if (x.dataset.id === c.id) x.classList.add('right');
          }
          const ok = b.dataset.id === c.id;
          if (!ok) b.classList.add('wrong');
          finishLearn(ok, { ok, exact: true }, ok ? null : b.textContent);
        });
      }
    } else if (style === 'type') {
      box.innerHTML = `<form class="type-row" id="learn-form" autocomplete="off">
          <input id="learn-input" type="text" spellcheck="false" autocapitalize="words" placeholder="${cc ? 'Capital' : 'Country'}" aria-label="Your answer">
          <button class="btn primary" type="submit">Check</button>
        </form>
        <button class="btn ghost" id="learn-skip" type="button">I don't know</button>`;
      const input = $('learn-input');
      $('learn-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (learn.done || !input.value.trim()) return;
        const res = checkAnswer(input.value, c, field);
        input.disabled = true;
        $('learn-skip').hidden = true;
        finishLearn(res.ok, res, input.value.trim());
      });
      $('learn-skip').addEventListener('click', () => {
        if (learn.done) return;
        input.disabled = true;
        $('learn-skip').hidden = true;
        finishLearn(false, null, null);
      });
      input.focus({ preventScroll: true });
    } else {
      box.innerHTML = '<button class="btn primary wide" id="learn-flip" type="button">Show answer</button>';
      $('learn-flip').addEventListener('click', () => {
        $('learn-map').parentElement.classList.remove('veiled');
        box.innerHTML = `<p class="flip-answer">${esc(c[field])}</p>
          <div class="grade-row">
            <button type="button" class="btn bad" data-ok="0">Didn't know</button>
            <button type="button" class="btn good" data-ok="1">Knew it</button>
          </div>`;
        for (const b of box.querySelectorAll('[data-ok]')) {
          b.addEventListener('click', () => {
            if (learn.done) return;
            box.innerHTML = '';
            finishLearn(b.dataset.ok === '1', null, null, true);
          });
        }
      });
    }
    updateLearnSession();
  }

  function finishLearn(ok, res, typed, flipped) {
    const c = BY_ID[learn.id];
    const cc = learn.kind === 'cc';
    learn.done = true;
    learn.total++;
    if (ok) learn.correct++;
    grade(learn.kind, learn.id, ok);
    $('learn-map').parentElement.classList.remove('veiled');

    let head;
    if (flipped) head = ok ? 'Good' : 'Now you know';
    else if (ok) head = res && !res.exact ? 'Correct, check the spelling' : 'Correct';
    else head = typed ? 'Not quite' : 'Here it is';

    let html = `<p class="fb-head">${head}</p>
      <p><strong>${esc(c.capital)}</strong> is the capital of <strong>${esc(theName(c))}</strong>.</p>`;
    if (typed && !(ok && res && res.exact)) html += `<p class="muted">You answered “${esc(typed)}”.</p>`;
    if (cc && c.alt.length) html += `<p class="muted">Also accepted: ${c.alt.map(esc).join(', ')}.</p>`;
    html += noteHtml(c);
    html += '<button type="button" class="btn primary wide" id="learn-next">Next</button>';

    const fb = $('learn-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = html;
    fb.hidden = false;
    $('learn-next').addEventListener('click', nextLearn);
    $('learn-next').focus({ preventScroll: true });
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateLearnSession();
  }

  function updateLearnSession() {
    const pool = poolIds();
    const learned = pool.filter((id) => status(id) === 'learned').length;
    const session = learn.total ? `${learn.correct} of ${learn.total} right this session · ` : '';
    $('learn-session').textContent = `${session}${learned} of ${pool.length} capitals learned`;
  }

  // ---------- Anagrams

  const round = { len: 10, i: 0, answered: 0, score: 0, missed: [], asked: new Set(), q: null, timer: null, deadline: 0 };

  const HINTS = [
    { label: 'Region', give: (c) => { showAnMap(c, 'region'); return null; } },
    { label: 'Country', give: (c) => { showAnMap(c, 'highlight'); return `It is the capital of ${theName(c)}.`; } },
    { label: 'Word lengths', give: (c, q) => `Word lengths: ${q.target.split(/[\s-]+/).map((w) => lettersOf(w).length).filter(Boolean).join(', ')}` },
    { label: 'First letter', give: (c, q) => `Starts with ${lettersOf(q.target)[0].toUpperCase()}` },
  ];

  function startRound() {
    stopTimer();
    Object.assign(round, { len: +state.settings.roundLen, i: 0, answered: 0, score: 0, missed: [], asked: new Set(), q: null });
    $('an-summary').hidden = true;
    $('an-card').hidden = false;
    nextAnagram();
  }

  function makeScramble(c, target) {
    const phrases = PHRASES[c.id] || [];
    const style = state.settings.anStyle;
    if (phrases.length && (style === 'phrase' || (style === 'mixed' && Math.random() < 0.6))) {
      return { words: shuffle(pickRandom(phrases).split(' ')), phrase: true };
    }
    const letters = lettersOf(target).toUpperCase().split('');
    let s, tries = 0;
    do { s = shuffle(letters); } while (s.join('') === letters.join('') && ++tries < 20);
    return { words: [s.join('')], phrase: false };
  }

  function nextAnagram() {
    stopTimer();
    if (round.len && round.i >= round.len) return showSummary();
    const id = pickCard('an', poolIds(), round.asked, Infinity);
    const c = BY_ID[id];
    const target = c.capital.split(',')[0]; // "Washington, D.C." -> Washington
    round.asked.add(id);
    round.i++;
    round.q = { id, target, scramble: makeScramble(c, target), hints: 0, hintText: [], done: false };
    renderAnagram();
    if (!$('view-anagram').hidden) startTimer();
  }

  function tilesHtml(words) {
    return words.map((w) => `<span class="word">${[...w].map((ch) =>
      `<span class="tile">${ch}<sub>${SCRABBLE[ch] || ''}</sub></span>`).join('')}</span>`).join('');
  }

  function renderAnagram() {
    const q = round.q;
    $('an-progress').textContent = round.len ? `Question ${round.i} of ${round.len}` : `Question ${round.i}`;
    $('an-score').textContent = `${round.score} pts`;
    const tiles = $('an-tiles');
    tiles.innerHTML = tilesHtml(q.scramble.words);
    tiles.classList.remove('deal', 'solved');
    void tiles.offsetWidth; // restart the deal animation
    tiles.classList.add('deal');
    $('an-count').textContent = `${lettersOf(q.target).length} letters` + (q.scramble.phrase ? ' · word anagram' : ' · shuffled');
    renderHints();
    const input = $('an-input');
    input.value = '';
    input.disabled = false;
    $('an-msg').textContent = '';
    $('an-feedback').hidden = true;
    $('an-map-wrap').hidden = true;
    $('an-giveup').hidden = false;
    if (!$('view-anagram').hidden) input.focus({ preventScroll: true });
  }

  function renderHints() {
    const q = round.q;
    $('an-hints').innerHTML = HINTS.map((h, i) => {
      const used = i < q.hints;
      return `<button type="button" class="hint${used ? ' used' : ''}" data-i="${i}" ${used || i !== q.hints || q.done ? 'disabled' : ''}>${h.label}${used ? '' : ' <span>−1</span>'}</button>`;
    }).join('');
    $('an-hint-out').innerHTML = q.hintText.map((t) => `<p>${esc(t)}</p>`).join('');
  }

  function useHint(i) {
    const q = round.q;
    if (q.done || i !== q.hints) return;
    const c = BY_ID[q.id];
    const text = HINTS[i].give(c, q);
    q.hints++;
    if (text) q.hintText.push(text);
    renderHints();
    $('an-input').focus({ preventScroll: true });
  }

  function showAnMap(c, mode) {
    $('an-map-wrap').hidden = false;
    drawMap($('an-map'), c, mode);
  }

  function finishAnagram(ok, res, reason) {
    const q = round.q;
    if (q.done) return;
    const c = BY_ID[q.id];
    q.done = true;
    stopTimer();
    const pts = ok ? Math.max(3 - q.hints, 1) : 0;
    round.score += pts;
    round.answered++;
    if (!ok) round.missed.push(q.id);
    grade('an', q.id, ok && q.hints <= 1);

    const tiles = $('an-tiles');
    tiles.innerHTML = tilesHtml(q.target.toUpperCase().split(/[\s-]+/).map(lettersOf).filter(Boolean));
    tiles.classList.remove('deal');
    tiles.classList.add('solved');
    showAnMap(c, 'highlight');
    renderHints();
    $('an-input').disabled = true;
    $('an-msg').textContent = '';
    $('an-giveup').hidden = true;
    $('an-score').textContent = `${round.score} pts`;

    const head = ok ? `+${pts} point${pts === 1 ? '' : 's'}` : reason === 'time' ? "Time's up" : 'The answer';
    let html = `<p class="fb-head">${head}</p>
      <p><strong>${esc(c.capital)}</strong>, capital of <strong>${esc(theName(c))}</strong>.</p>`;
    if (q.scramble.phrase) html += `<p class="muted">The anagram was ${esc(q.scramble.words.join(' '))}.</p>`;
    if (ok && res && !res.exact) html += `<p class="muted">Spelled ${esc(c.capital)}.</p>`;
    html += noteHtml(c);
    const last = round.len && round.i >= round.len;
    html += `<button type="button" class="btn primary wide" id="an-next">${last ? 'See your score' : 'Next'}</button>`;
    const fb = $('an-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = html;
    fb.hidden = false;
    $('an-next').addEventListener('click', nextAnagram);
    $('an-next').focus({ preventScroll: true });
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function startTimer() {
    const secs = +state.settings.timer;
    const el = $('an-timer');
    el.hidden = !secs;
    if (!secs || !round.q || round.q.done) return;
    round.deadline = Date.now() + secs * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((round.deadline - Date.now()) / 1000));
      el.textContent = `${left}s`;
      el.classList.toggle('low', left <= 5);
      if (left === 0) finishAnagram(false, null, 'time');
    };
    tick();
    round.timer = setInterval(tick, 250);
  }

  function stopTimer() {
    clearInterval(round.timer);
    round.timer = null;
  }

  function showSummary() {
    stopTimer();
    const max = round.answered * 3;
    const pct = max ? round.score / max : 0;
    const verdict = !round.answered ? 'No questions answered.'
      : pct >= 0.85 ? 'Quiz-night ready.'
      : pct >= 0.6 ? 'Solid. Hints cost you a few points.'
      : 'Keep practising the ones below.';
    const missed = round.missed.map((id) => BY_ID[id]);
    $('an-card').hidden = true;
    const sum = $('an-summary');
    sum.hidden = false;
    sum.innerHTML = `<p class="eyebrow">Round over</p>
      <p class="big-score">${round.score}<span> / ${max}</span></p>
      <p>${verdict}</p>
      ${missed.length ? `<h3>Missed</h3><ul class="missed">${missed.map((c) =>
        `<li><strong>${esc(c.capital)}</strong><span>${esc(c.name)}</span></li>`).join('')}</ul>` : ''}
      <button type="button" class="btn primary wide" id="an-again">Play another round</button>`;
    $('an-again').addEventListener('click', startRound);
  }

  function initAnagram() {
    $('an-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = round.q;
      const input = $('an-input');
      if (!q || q.done || !input.value.trim()) return;
      const res = checkAnswer(input.value, BY_ID[q.id], 'capital');
      if (res.ok) return finishAnagram(true, res);
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      input.select();
      $('an-msg').textContent = 'Not quite. Try again, or take a hint.';
    });
    $('an-hints').addEventListener('click', (e) => {
      const b = e.target.closest('.hint');
      if (b) useHint(+b.dataset.i);
    });
    $('an-giveup').addEventListener('click', () => finishAnagram(false, null, 'giveup'));
    $('an-end').addEventListener('click', () => {
      if (round.q && !round.q.done) round.asked.delete(round.q.id);
      showSummary();
    });
  }

  // ---------- Atlas

  let atlasShown = false;

  function renderAtlas() {
    $('atlas-mastery').innerHTML = CONTINENTS.map((cont) => {
      const cs = COUNTRIES.filter((c) => c.continent === cont);
      const learned = cs.filter((c) => status(c.id) === 'learned').length;
      const learning = cs.filter((c) => status(c.id) === 'learning').length;
      const pct = (n) => (100 * n / cs.length).toFixed(1);
      return `<div class="m-row">
        <span class="m-name">${cont}</span>
        <span class="meter" role="img" aria-label="${learned} learned, ${learning} in progress, of ${cs.length}">
          <i class="learned" style="width:${pct(learned)}%"></i><i class="learning" style="width:${pct(learning)}%"></i>
        </span>
        <span class="num">${learned}/${cs.length}</span>
      </div>`;
    }).join('') + `<p class="legend"><span class="dot learned"></span>learned <span class="dot learning"></span>in progress <span class="dot new"></span>new</p>`;

    $('atlas-list').innerHTML = CONTINENTS.map((cont) => `<section class="group" data-cont="${cont}">
        <h3>${cont}</h3>
        ${COUNTRIES.filter((c) => c.continent === cont).map((c) => `<button type="button" class="row" data-id="${c.id}" data-q="${norm(c.name + ' ' + c.aliases.join(' ') + ' ' + c.capital + ' ' + c.alt.join(' '))}">
          <span class="dot ${status(c.id)}"></span><span class="c">${esc(c.name)}</span><span class="k">${esc(c.capital)}</span>
        </button>`).join('')}
      </section>`).join('');
    filterAtlas();
    if (!atlasShown) showAtlas(pickRandom(COUNTRIES).id);
  }

  function showAtlas(id) {
    const c = BY_ID[id];
    atlasShown = true;
    drawMap($('atlas-map'), c, 'highlight');
    $('atlas-caption').innerHTML = `<strong>${esc(c.capital)}</strong> is the capital of <strong>${esc(theName(c))}</strong>.` +
      (c.alt.length ? ` Also accepted: ${c.alt.map(esc).join(', ')}.` : '') + (c.note ? ` ${esc(c.note)}` : '');
    for (const r of document.querySelectorAll('#atlas-list .row')) r.classList.toggle('current', r.dataset.id === id);
  }

  function filterAtlas() {
    const q = norm($('atlas-search').value || '');
    for (const g of document.querySelectorAll('#atlas-list .group')) {
      let any = false;
      for (const r of g.querySelectorAll('.row')) {
        const hit = !q || r.dataset.q.includes(q);
        r.hidden = !hit;
        any = any || hit;
      }
      g.hidden = !any;
    }
  }

  function initAtlas() {
    $('atlas-list').addEventListener('click', (e) => {
      const r = e.target.closest('.row');
      if (r) showAtlas(r.dataset.id);
    });
    $('atlas-search').addEventListener('input', filterAtlas);
  }

  // ---------- tabs

  function showView(view) {
    for (const t of document.querySelectorAll('.tabs [role=tab]')) t.setAttribute('aria-selected', String(t.dataset.view === view));
    for (const v of ['learn', 'anagram', 'atlas']) $('view-' + v).hidden = v !== view;
    state.settings.tab = view;
    save();
    if (view === 'anagram') {
      if (round.q && !round.q.done && !round.timer) startTimer();
    } else {
      stopTimer();
    }
    if (view === 'atlas') renderAtlas();
    if (view === 'learn') updateLearnSession();
  }

  function initTabs() {
    for (const t of document.querySelectorAll('.tabs [role=tab]')) t.addEventListener('click', () => showView(t.dataset.view));
  }

  // ---------- settings

  const SELECTS = {
    'set-direction': 'direction', 'set-style': 'style', 'set-mapreveal': 'mapReveal',
    'set-anstyle': 'anStyle', 'set-roundlen': 'roundLen', 'set-timer': 'timer',
  };
  const LEARN_KEYS = ['direction', 'style', 'mapReveal'];
  let changed = new Set();

  function fillSettings() {
    for (const [id, key] of Object.entries(SELECTS)) $(id).value = String(state.settings[key]);
    $('set-regions').innerHTML = CONTINENTS.map((r) =>
      `<button type="button" class="chip" data-r="${r}" aria-pressed="${state.settings.regions.includes(r)}">${r}</button>`).join('');
    $('reset-confirm').hidden = true;
    $('backup-msg').textContent = '';
    $('copy-btn').hidden = true;
    $('backup-code').value = '';
  }

  function initSettings() {
    const dlg = $('settings');
    $('open-settings').addEventListener('click', () => { changed = new Set(); fillSettings(); dlg.showModal(); });

    for (const [id, key] of Object.entries(SELECTS)) {
      $(id).addEventListener('change', (e) => {
        const v = e.target.value;
        state.settings[key] = ['roundLen', 'timer'].includes(key) ? +v : v;
        changed.add(key);
        save();
      });
    }

    $('set-regions').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const r = b.dataset.r;
      const regs = state.settings.regions.includes(r)
        ? state.settings.regions.filter((x) => x !== r)
        : [...state.settings.regions, r];
      if (!regs.length) return; // keep at least one region
      state.settings.regions = regs;
      b.setAttribute('aria-pressed', String(regs.includes(r)));
      changed.add('regions');
      save();
    });

    let resetArmed = null;
    $('reset-progress').addEventListener('click', () => {
      if (!resetArmed) {
        $('reset-confirm').hidden = false;
        resetArmed = setTimeout(() => { resetArmed = null; $('reset-confirm').hidden = true; }, 5000);
        return;
      }
      clearTimeout(resetArmed);
      resetArmed = null;
      state.cards = {};
      save();
      $('reset-confirm').hidden = true;
      $('backup-msg').textContent = 'Progress reset.';
      changed.add('cards');
    });

    $('export-btn').addEventListener('click', () => {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify({ app: 'capitalgram', v: 1, cards: state.cards }))));
      $('backup-code').value = code;
      $('copy-btn').hidden = false;
      $('backup-msg').textContent = `Backup of ${Object.keys(state.cards).length} cards. Copy it somewhere safe.`;
    });

    $('copy-btn').addEventListener('click', () => {
      const ta = $('backup-code');
      const fallback = () => { ta.focus(); ta.select(); $('backup-msg').textContent = 'Selected. Copy it with your keyboard or long-press.'; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(ta.value).then(() => { $('backup-msg').textContent = 'Copied.'; }, fallback);
      } else fallback();
    });

    $('import-btn').addEventListener('click', () => {
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob($('backup-code').value.trim()))));
        if (!data || data.app !== 'capitalgram' || typeof data.cards !== 'object') throw new Error('not a backup');
        state.cards = data.cards;
        save();
        changed.add('cards');
        $('backup-msg').textContent = `Restored ${Object.keys(data.cards).length} cards.`;
      } catch (e) {
        $('backup-msg').textContent = 'That is not a Capitalgram backup code. Paste the whole code and try again.';
      }
    });

    dlg.addEventListener('close', () => {
      if (!changed.size) return;
      if (changed.has('regions') || changed.has('cards') || LEARN_KEYS.some((k) => changed.has(k))) nextLearn();
      if (changed.has('regions') || changed.has('anStyle') || changed.has('roundLen') || changed.has('timer')) startRound();
      if (!$('view-atlas').hidden) renderAtlas();
      changed = new Set();
    });
  }

  // ---------- start

  async function init() {
    try {
      await loadData();
    } catch (e) {
      document.querySelector('main').innerHTML =
        `<p class="error">Could not load the map and country data (${esc(e.message)}). Check your connection and reload.</p>`;
      return;
    }
    initTabs();
    initSettings();
    initAnagram();
    initAtlas();
    nextLearn();
    startRound();
    showView(['learn', 'anagram', 'atlas'].includes(state.settings.tab) ? state.settings.tab : 'learn');

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
    }
  }

  init();
})();
