/**
 * The whole web app — login, self-service picks, and (for admins) the admin
 * dashboard — deliberately one dependency-free string: no build step, no
 * CDN, works on a phone browser from the couch.
 */
export const ADMIN_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golf League</title>
<style>
  :root { --bg:#0f1512; --panel:#18211c; --line:#2b382f; --text:#e8f0ea; --muted:#93a89a; --accent:#4ba36a; --warn:#d9a441; --bad:#d96a5a; --admin:#9b8cff; --admin-bg:#1c1a2e; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:14px 18px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; font-weight:650; }
  nav { display:flex; gap:4px; flex-wrap:wrap; }
  nav button { background:transparent; border:1px solid transparent; color:var(--muted); padding:6px 11px; border-radius:7px; cursor:pointer; font-size:14px; }
  nav button.on { background:var(--panel); border-color:var(--line); color:var(--text); }
  /* Admin-only nav gets its own color so it always reads as a separate zone from participant self-service. */
  nav button[data-admin] { background:var(--admin-bg); border-color:rgba(155,140,255,.28); color:#c8bfff; }
  nav button[data-admin].on { background:var(--admin); border-color:var(--admin); color:#0f0b24; }
  main { padding:18px; max-width:1100px; }
  section { display:none; }
  section.on { display:block; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:14px; }
  .card h2 { font-size:14px; margin:0 0 10px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:13px; }
  td.num, th.num { text-align:right; }
  input,select,textarea,button.act { background:#101713; border:1px solid var(--line); color:var(--text); border-radius:7px; padding:7px 9px; font:inherit; }
  textarea { width:100%; min-height:90px; resize:vertical; }
  button.act { cursor:pointer; background:var(--accent); border-color:var(--accent); color:#08150d; font-weight:600; }
  button.act.ghost { background:transparent; color:var(--text); border-color:var(--line); font-weight:500; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px; }
  .pill { font-size:12px; padding:2px 8px; border-radius:99px; border:1px solid var(--line); color:var(--muted); }
  .pill.test { color:var(--warn); border-color:var(--warn); }
  .dead { color:var(--bad); text-decoration:line-through; }
  .hearn { color:var(--warn); }
  .muted { color:var(--muted); }
  #toast { position:fixed; right:16px; bottom:16px; background:var(--panel); border:1px solid var(--line); padding:10px 14px; border-radius:8px; display:none; max-width:60ch; z-index:10; }
  .stat { font-size:24px; font-weight:650; }
  .authWrap { max-width:360px; margin:60px auto; padding:0 16px; }
  .authWrap input { width:100%; }
</style>
</head>
<body>

<div id="authScreen" style="display:none">
  <div class="authWrap">
    <div class="card">
      <h2>Log in</h2>
      <div class="row"><input id="loginEmail" type="email" placeholder="Email" autocomplete="username"></div>
      <div class="row"><input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password"></div>
      <div class="row"><button class="act" id="loginGo" style="width:100%">Log in</button></div>
      <p class="muted"><a href="#" id="forgotLink" style="color:inherit">Forgot your password?</a></p>
      <div id="forgotBox" style="display:none">
        <div class="row"><input id="forgotEmail" type="email" placeholder="Email"></div>
        <div class="row"><button class="act ghost" id="forgotGo" style="width:100%">Email me a reset link</button></div>
      </div>
    </div>
  </div>
</div>

<div id="setpwScreen" style="display:none">
  <div class="authWrap">
    <div class="card">
      <h2>Set your password</h2>
      <div class="row"><input id="setpwPassword" type="password" placeholder="New password (min 8 characters)" autocomplete="new-password"></div>
      <div class="row"><button class="act" id="setpwGo" style="width:100%">Set password</button></div>
    </div>
  </div>
</div>

<div id="app" style="display:none">
<header>
  <h1>⛳ Golf League</h1>
  <select id="seasonPicker" data-admin></select>
  <span class="row" style="margin-left:12px">
    <input id="nickInput" placeholder="Your nickname" style="width:140px">
    <button class="act ghost" id="nickGo">Save</button>
  </span>
  <nav>
    <button data-tab="mypicks" class="on">My Picks</button>
    <button data-tab="myhearn">Hearn Picks</button>
    <button data-tab="dash" data-admin>Dashboard</button>
    <button data-tab="picks" data-admin>Picks</button>
    <button data-tab="hearn" data-admin>Hearn Lists</button>
    <button data-tab="schedule" data-admin>Schedule</button>
    <button data-tab="results" data-admin>Results</button>
    <button data-tab="roster" data-admin>Roster</button>
    <button data-tab="seasons" data-admin>Seasons</button>
  </nav>
  <button class="act ghost" id="logoutBtn" style="margin-left:auto">Log out</button>
</header>
<main>
  <section id="mypicks" class="on"></section>
  <section id="myhearn"></section>
  <section id="dash"></section>
  <section id="picks"></section>
  <section id="hearn"></section>
  <section id="schedule"></section>
  <section id="results"></section>
  <section id="roster"></section>
  <section id="seasons"></section>
</main>
</div>
<div id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
let ME = null, MY = null, STATE = null, SEASON = null, REPORT = null;

function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderColor = bad ? 'var(--bad)' : 'var(--line)';
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 3200);
}
async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || 'GET',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const money = (n) => '$' + Math.round(n).toLocaleString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pname = (id, report) => (report && report.nameByParticipantId[id]) || id;
const oddsLabel = (odds) => (odds == null ? '' : ' (' + (odds > 0 ? '+' : '') + odds + ')');

/**
 * Builds a golfer <select>'s options from the current field (with odds when
 * available), plus any "extra" names that must stay selectable even though
 * they're not in that field — an existing pick/Hearn entry made before the
 * field changed, so it never silently vanishes from the dropdown and gets
 * lost on the next save. Names in usedNames (already picked another week
 * this season — one-and-done) render struck-through and disabled, unless
 * it's the currently selected option, so switching away from it still works.
 */
function golferOptionsHtml(field, extraNames, selectedName, usedNames) {
  const inField = new Set((field || []).map((g) => g.name));
  const extras = (extraNames || []).filter((n) => n && !inField.has(n)).map((n) => ({ name: n, odds: null }));
  const pool = [...(field || []), ...extras].sort((a, b) => a.name.localeCompare(b.name));
  const used = usedNames || new Set();
  return (
    '<option value="">—</option>' +
    pool.map((g) => {
      const isUsed = used.has(g.name) && g.name !== selectedName;
      const label = esc(g.name) + esc(oddsLabel(g.odds)) + (isUsed ? ' (used)' : '');
      return '<option value="' + esc(g.name) + '"' +
        (g.name === selectedName ? ' selected' : '') +
        (isUsed ? ' disabled style="text-decoration:line-through;color:var(--muted)"' : '') +
        '>' + label + '</option>';
    }).join('')
  );
}

// ---- boot / auth ----------------------------------------------------------

function showScreen(id) {
  ['authScreen', 'setpwScreen', 'app'].forEach((x) => { $(x).style.display = x === id ? '' : 'none'; });
}

function wireAuthScreen() {
  $('loginGo').onclick = async () => {
    try {
      await api('/api/auth/login', 'POST', { email: $('loginEmail').value, password: $('loginPassword').value });
      location.reload();
    } catch (e) { toast(e.message, true); }
  };
  $('forgotLink').onclick = (e) => { e.preventDefault(); $('forgotBox').style.display = 'block'; };
  $('forgotGo').onclick = async () => {
    try {
      await api('/api/auth/request-reset', 'POST', { email: $('forgotEmail').value });
      toast('If that email is on the roster, a link is on its way.');
    } catch (e) { toast(e.message, true); }
  };
}

function wireSetpwScreen(token) {
  $('setpwGo').onclick = async () => {
    try {
      await api('/api/auth/set-password', 'POST', { token, password: $('setpwPassword').value });
      location.href = '/';
    } catch (e) { toast(e.message, true); }
  };
}

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === b.dataset.tab));
    render();
  };
});
$('logoutBtn').onclick = async () => {
  try { await api('/api/auth/logout', 'POST', {}); } catch { /* ignore */ }
  location.reload();
};

async function boot() {
  const setpwToken = new URLSearchParams(location.search).get('setpw');
  if (setpwToken) {
    showScreen('setpwScreen');
    wireSetpwScreen(setpwToken);
    return;
  }

  try {
    ME = await api('/api/me');
  } catch {
    showScreen('authScreen');
    wireAuthScreen();
    return;
  }

  showScreen('app');
  document.querySelectorAll('[data-admin]').forEach((el) => { el.style.display = ME.isAdmin ? '' : 'none'; });

  $('nickInput').value = ME.nickname || '';
  $('nickGo').onclick = async () => {
    try {
      ME = { ...ME, ...(await api('/api/my/nickname', 'PUT', { nickname: $('nickInput').value })) };
      toast('Nickname saved'); await loadMyState(); if (ME.isAdmin) await loadSeason(); render();
    } catch (e) { toast(e.message, true); }
  };

  await loadMyState();
  if (ME.isAdmin) await bootAdmin();
  render();
}

async function loadMyState() {
  MY = await api('/api/my/state');
}

async function bootAdmin() {
  STATE = await api('/api/state');
  const sel = $('seasonPicker');
  const previous = sel.value; // sticky: rebuilding options below would otherwise silently reset the pick
  sel.innerHTML = STATE.seasons.map((s) => {
    const lg = STATE.leagues.find((l) => l.id === s.leagueId);
    return '<option value="' + s.id + '">' + esc((lg ? lg.name : '?') + ' — ' + s.year + ' (' + s.status + ')') + '</option>';
  }).join('') || '<option value="">No seasons yet</option>';

  // Keep whatever was already selected if it still exists; otherwise default
  // to the (in practice, singular) ACTIVE season rather than just the first
  // one in the list, which could easily be an old COMPLETE season.
  const stillExists = previous && STATE.seasons.some((s) => s.id === previous);
  const active = STATE.seasons.find((s) => s.status === 'ACTIVE');
  sel.value = stillExists ? previous : (active ? active.id : (STATE.seasons[0] ? STATE.seasons[0].id : ''));

  sel.onchange = loadSeason;
  await loadSeason();
}
async function loadSeason() {
  const id = $('seasonPicker').value;
  if (!id) { REPORT = null; SEASON = null; return render(); }
  REPORT = await api('/api/seasons/' + id + '/report');
  SEASON = REPORT.season;
  render();
}

function render() {
  const tab = document.querySelector('nav button.on').dataset.tab;
  const el = $(tab);
  if (tab === 'mypicks') return renderMyPicksTab(el);
  if (tab === 'myhearn') return renderMyHearnTab(el);
  if (!REPORT && tab !== 'seasons') {
    el.innerHTML = '<div class="card"><p class="muted">No season selected. Create one in the Seasons tab.</p></div>';
    return;
  }
  ({ dash: renderDash, picks: renderPicks, hearn: renderHearn, schedule: renderSchedule,
     results: renderResults, roster: renderRoster, seasons: renderSeasons })[tab](el);
}

// ---- shared standings/pots rendering (used by My Picks and the admin Dashboard) ----

function standingsTable(rows, report) {
  if (!rows || !rows.length) return '<p class="muted">No results yet.</p>';
  return '<table><tr><th>#</th><th>Participant</th><th class="num">Earnings</th></tr>' +
    rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(pname(r.participantId, report)) +
      '</td><td class="num">' + money(r.totalEarnings) + '</td></tr>').join('') + '</table>';
}

function potsCardsHtml(report, season, tournaments) {
  const sp = report.sidePot1, gr = report.greller, tocc = report.tocc;
  return (
    '<div class="card"><h2>Side Pot — Most Top 10s</h2>' +
      '<p class="stat">' + money(sp.balance) + '</p>' +
      '<p class="muted">Funded by ' + money(season.missedCutFine) + ' missed-cut fines</p>' +
      '<table><tr><th>Participant</th><th class="num">MC</th><th class="num">Owed</th><th class="num">T10</th><th class="num">T5</th><th class="num">Wins</th></tr>' +
      sp.tallies.slice().sort((a,b) => b.top10s - a.top10s || b.top5s - a.top5s || b.wins - a.wins)
        .map((t) => '<tr><td>' + esc(pname(t.participantId, report)) + '</td><td class="num">' + t.missedCuts +
          '</td><td class="num">' + money(t.missedCuts * season.missedCutFine) + '</td><td class="num">' + t.top10s +
          '</td><td class="num">' + t.top5s + '</td><td class="num">' + t.wins + '</td></tr>').join('') +
      '</table></div>' +
    '<div class="card"><h2>The Greller</h2>' +
      '<p class="stat">' + money(gr.currentBalance) + '</p>' +
      '<p class="muted">' + money(season.grellerWeeklyContribution) + '/participant/week; won by a unique pick of the winner</p>' +
      '<table><tr><th>Week</th><th>Winner</th><th class="num">Amount</th><th class="num">Pot after</th></tr>' +
      gr.history.map((w) => {
        const t = tournaments.find((x) => x.id === w.tournamentId);
        const amount = w.winnerParticipantId ? -w.amountWon : w.contribution;
        return '<tr><td>' + esc(t ? t.name : w.tournamentId) + '</td><td>' +
          (w.winnerParticipantId ? esc(pname(w.winnerParticipantId, report)) : '<span class="muted">rollover</span>') +
          '</td><td class="num" style="color:' + (amount < 0 ? 'var(--accent)' : 'inherit') + '">' + money(amount) +
          '</td><td class="num">' + money(w.potBalanceAfter) + '</td></tr>';
      }).join('') + '</table></div>' +
    '<div class="card"><h2>TOCC Side Action</h2>' +
      '<p class="muted">' + money(season.toccStake) + '/wk, ' + money(season.toccStakeIfWinner) + ' if the pick wins outright</p>' +
      '<table><tr><th>Participant</th><th class="num">Net</th></tr>' +
      Object.entries(tocc.netByParticipant).sort((a,b) => b[1] - a[1])
        .map(([id, net]) => '<tr><td>' + esc(pname(id, report)) + '</td><td class="num" style="color:' +
          (net >= 0 ? 'var(--accent)' : 'var(--bad)') + '">' + money(net) + '</td></tr>').join('') +
      '</table></div>'
  );
}

// ---- My Picks (every logged-in participant) --------------------------------

function renderMyPicksTab(el) {
  if (!MY.season) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(MY.failureMessage || 'No active season.') + '</p></div>';
    return;
  }

  const pt = MY.pickTarget;
  const existingName = MY.existingPick ? MY.existingPick.golferName : null;
  const usedNames = new Set(
    MY.myPicks.filter((p) => !pt || p.tournamentId !== pt.id).map((p) => p.golferName)
  );
  const pickCard = pt
    ? '<div class="card"><h2>' + esc(pt.name) + '</h2>' +
        '<p class="muted">Deadline: ' + new Date(pt.startTime).toLocaleString() +
        (existingName ? ' · Current pick: <strong>' + esc(existingName) + '</strong>' : '') + '</p>' +
        '<div class="row">' +
          '<select id="myPickG" style="min-width:240px">' + golferOptionsHtml(pt.field, [existingName], existingName, usedNames) + '</select>' +
          '<button class="act" id="myPickGo">' + (existingName ? 'Update pick' : 'Submit pick') + '</button>' +
        '</div></div>'
    : '<div class="card"><p class="muted">No upcoming tournament open for picks right now.</p></div>';

  const picksTable = MY.myPicks.length
    ? '<table><tr><th>Week</th><th>Golfer</th><th>Source</th></tr>' +
      MY.myPicks.map((p) => '<tr><td>' + esc(p.tournamentName) + '</td><td>' + esc(p.golferName) +
        '</td><td class="' + (p.source === 'hearn' ? 'hearn' : 'muted') + '">' + esc(p.source) + '</td></tr>').join('') +
      '</table>'
    : '<p class="muted">No picks yet this season.</p>';

  const q = MY.report.quarterStandings || {};
  el.innerHTML =
    pickCard +
    '<div class="card"><h2>Season Standings</h2>' + standingsTable(MY.report.seasonStandings, MY.report) + '</div>' +
    '<div class="grid2">' + [1,2,3,4].map((n) =>
      '<div class="card"><h2>Quarter ' + n + '</h2>' + standingsTable(q[n], MY.report) + '</div>').join('') + '</div>' +
    '<div class="grid2">' + potsCardsHtml(MY.report, MY.season, MY.tournaments) + '</div>' +
    '<div class="card"><h2>Your picks this season</h2>' + picksTable + '</div>';

  if (pt) {
    $('myPickGo').onclick = async () => {
      const golferName = $('myPickG').value;
      if (!golferName) return toast('Choose a golfer first', true);
      try {
        const r = await api('/api/my/pick', 'POST', { tournamentId: pt.id, golferName });
        toast(r.message, !r.ok);
        if (r.ok) { await loadMyState(); render(); }
      } catch (e) { toast(e.message, true); }
    };
  }
}

function renderMyHearnTab(el) {
  if (!MY.season) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(MY.failureMessage || 'No active season.') + '</p></div>';
    return;
  }

  // Season-long fallback, not scoped to one week — options are the whole PGA
  // Tour roster (via hearnPool from the server), plus anything already on
  // the list, so a golfer never silently drops off just because they're not
  // in this week's field.
  const pool = MY.hearnPool && MY.hearnPool.length ? MY.hearnPool : (MY.pickTarget ? MY.pickTarget.field : []);
  const hearnExtras = MY.hearnList.map((h) => h.golferName);
  const hearnSlotCount = Math.max(MY.hearnList.length + 3, 6);
  const hearnRows = Array.from({ length: hearnSlotCount }, (_, i) => {
    const existing = MY.hearnList[i];
    return '<div class="row"><span class="muted" style="width:20px">' + (i + 1) + '.</span>' +
      '<select data-hearn-slot="' + i + '" style="min-width:240px">' +
      golferOptionsHtml(pool, hearnExtras, existing ? existing.golferName : '') +
      '</select></div>';
  }).join('');

  el.innerHTML =
    '<div class="card"><h2>Hearn Picks</h2>' +
    '<p class="muted">Ordered fallback used automatically if you forget to pick a given week. Drawn from the full PGA Tour roster — this list is good for the whole season, not just the current tournament.</p>' +
    hearnRows +
    '<div class="row" style="margin-top:8px"><button class="act" id="myHearnGo">Save Hearn Picks</button></div></div>';

  $('myHearnGo').onclick = async () => {
    const golferNames = el.querySelectorAll('[data-hearn-slot]');
    const names = Array.from(golferNames).map((s) => s.value).filter((v) => v);
    try {
      await api('/api/my/hearn', 'PUT', { golferNames: names });
      toast('Hearn Picks saved'); await loadMyState(); render();
    } catch (e) { toast(e.message, true); }
  };
}

// ---- admin tabs -------------------------------------------------------------

function renderDash(el) {
  const q = REPORT.quarterStandings || {};
  el.innerHTML =
    '<div class="card"><h2>Season Standings</h2>' + standingsTable(REPORT.seasonStandings, REPORT) + '</div>' +
    '<div class="grid2">' + [1,2,3,4].map((n) =>
      '<div class="card"><h2>Quarter ' + n + '</h2>' + standingsTable(q[n], REPORT) + '</div>').join('') + '</div>' +
    '<div class="grid2">' + potsCardsHtml(REPORT, SEASON, REPORT.tournaments) + '</div>';
}

async function renderPicks(el) {
  const picks = await api('/api/seasons/' + SEASON.id + '/picks');
  const tOpts = REPORT.tournaments.map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
  const pOpts = REPORT.roster.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  el.innerHTML =
    '<div class="card"><h2>Enter / override a pick</h2><div class="row">' +
      '<select id="pkT">' + tOpts + '</select><select id="pkP">' + pOpts + '</select>' +
      '<input id="pkG" placeholder="Golfer name">' +
      '<label class="muted"><input type="checkbox" id="pkF"> force (deadline/field only)</label>' +
      '<button class="act" id="pkGo">Save pick</button>' +
    '</div><p class="muted">One-and-done can never be forced — a repeat golfer is always rejected.</p></div>' +
    '<div class="card"><h2>Run Hearn fallbacks</h2><div class="row">' +
      '<select id="hrT">' + tOpts + '</select>' +
      '<button class="act ghost" id="hrDry">Preview</button>' +
      '<button class="act" id="hrGo">Apply</button>' +
    '</div><div id="hrOut"></div></div>' +
    '<div class="card"><h2>All picks (' + picks.length + ')</h2><table>' +
      '<tr><th>Week</th><th>Participant</th><th>Golfer</th><th>Source</th></tr>' +
      picks.map((p) => {
        const t = REPORT.tournaments.find((x) => x.id === p.tournamentId);
        return '<tr><td>' + esc(t ? t.name : p.tournamentId) + '</td><td>' + esc(p.participantName) +
          '</td><td>' + esc(p.golferName) + '</td><td class="' + (p.source === 'hearn' ? 'hearn' : 'muted') +
          '">' + esc(p.source) + '</td></tr>';
      }).join('') + '</table></div>';

  $('pkGo').onclick = async () => {
    try {
      await api('/api/picks', 'POST', { tournamentId: $('pkT').value, participantId: $('pkP').value,
        golferName: $('pkG').value, force: $('pkF').checked });
      toast('Pick saved'); loadSeason();
    } catch (e) { toast(e.message, true); }
  };
  const runHearn = async (commit) => {
    try {
      const out = await api('/api/tournaments/' + $('hrT').value + '/run-hearn', 'POST', { commit });
      $('hrOut').innerHTML =
        (out.assigned.length ? '<table><tr><th>Participant</th><th>Auto-assigned</th></tr>' +
          out.assigned.map((a) => '<tr><td>' + esc(a.participantName) + '</td><td class="hearn">' +
            esc(a.golferName) + '</td></tr>').join('') + '</table>'
          : '<p class="muted">Nobody needs a fallback — everyone has a pick.</p>') +
        (out.unresolved.length ? '<p class="dead">No valid Hearn pick left for: ' +
          out.unresolved.map(esc).join(', ') + '</p>' : '') +
        '<p class="muted">' + (out.committed ? 'Applied.' : 'Preview only — nothing saved.') + '</p>';
      if (commit) loadSeason();
    } catch (e) { toast(e.message, true); }
  };
  $('hrDry').onclick = () => runHearn(false);
  $('hrGo').onclick = () => runHearn(true);
}

async function renderHearn(el) {
  const list = await api('/api/seasons/' + SEASON.id + '/hearn');
  const byP = {};
  list.forEach((h) => { (byP[h.participantId] = byP[h.participantId] || []).push(h); });
  el.innerHTML = '<div class="card"><h2>Hearn lists</h2><p class="muted">' +
    'Ordered fallback used when someone forgets to pick. Struck-through golfers are already used this season and will be skipped.</p></div>' +
    REPORT.roster.map((p) => {
      const hs = (byP[p.id] || []).sort((a, b) => a.rank - b.rank);
      return '<div class="card"><h2>' + esc(p.name) + '</h2>' +
        (hs.length ? '<p>' + hs.map((h) => '<span class="' + (h.isDead ? 'dead' : '') + '">' +
          h.rank + '. ' + esc(h.golferName) + '</span>').join(' &nbsp;·&nbsp; ') + '</p>'
          : '<p class="muted">No Hearn list — they take a zero if they forget.</p>') +
        '<textarea id="hx' + p.id + '" placeholder="One golfer per line, in preference order">' +
        hs.map((h) => esc(h.golferName)).join('\\n') + '</textarea>' +
        '<div class="row" style="margin-top:8px"><button class="act" data-save="' + p.id + '">Save list</button></div></div>';
    }).join('');
  el.querySelectorAll('[data-save]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.save;
      try {
        await api('/api/seasons/' + SEASON.id + '/hearn/' + id, 'PUT',
          { golferNames: $('hx' + id).value.split('\\n') });
        toast('Hearn list saved'); render();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function renderSchedule(el) {
  el.innerHTML =
    '<div class="card"><h2>Add tournament</h2><div class="row">' +
      '<input id="tName" placeholder="Tournament name">' +
      '<input id="tStart" type="datetime-local">' +
      '<label class="muted"><input type="checkbox" id="tFin"> season finale</label>' +
      '<button class="act" id="tGo">Add</button>' +
    '</div><p class="muted">Start time doubles as the pick deadline — picks must arrive strictly before it.</p></div>' +
    '<div class="card"><h2>Schedule (' + REPORT.tournaments.length + ')</h2><table>' +
      '<tr><th>#</th><th>Tournament</th><th>Starts / deadline</th><th>Field</th></tr>' +
      REPORT.tournaments.map((t) => '<tr><td>' + t.sequence + '</td><td>' + esc(t.name) +
        (t.isSeasonFinale ? ' <span class="pill">finale</span>' : '') + '</td><td>' +
        new Date(t.startTime).toLocaleString() + '</td><td><button class="act ghost" data-fld="' + t.id +
        '">Set field</button></td></tr>').join('') + '</table></div>' +
    '<div class="card" id="fldBox" style="display:none"><h2>Field for <span id="fldName"></span></h2>' +
      '<textarea id="fldTxt" placeholder="One golfer per line"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="act" id="fldGo">Save field</button></div></div>';

  $('tGo').onclick = async () => {
    try {
      await api('/api/tournaments', 'POST', { seasonId: SEASON.id, name: $('tName').value,
        startTime: $('tStart').value, isSeasonFinale: $('tFin').checked });
      toast('Tournament added'); loadSeason();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-fld]').forEach((b) => {
    b.onclick = () => {
      const t = REPORT.tournaments.find((x) => x.id === b.dataset.fld);
      $('fldBox').style.display = 'block';
      $('fldName').textContent = t.name;
      $('fldGo').dataset.id = t.id;
    };
  });
  $('fldGo').onclick = async () => {
    try {
      const r = await api('/api/tournaments/' + $('fldGo').dataset.id + '/field', 'PUT',
        { golferNames: $('fldTxt').value.split('\\n') });
      toast('Field saved (' + r.fieldSize + ' golfers)');
    } catch (e) { toast(e.message, true); }
  };
}

function renderResults(el) {
  el.innerHTML =
    '<div class="card"><h2>Post results</h2><div class="row">' +
      '<select id="rT">' + REPORT.tournaments.map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select>' +
    '</div>' +
    '<textarea id="rTxt" placeholder="One per line:  Golfer Name, earnings, finish\\nScottie Scheffler, 3600000, 1\\nJordan Spieth, 0, CUT"></textarea>' +
    '<div class="row" style="margin-top:8px"><button class="act" id="rGo">Save results</button></div>' +
    '<p class="muted">Finish of CUT/WD/MDF (or blank) counts as a missed cut and triggers the Side Pot fine.</p></div>';

  $('rGo').onclick = async () => {
    const rows = $('rTxt').value.split('\\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      const fin = parts[2] || '';
      return { golferName: parts[0], earnings: Number((parts[1] || '0').replace(/[$,]/g, '')) || 0,
        finishPosition: /^T?\\d+$/.test(fin) ? Number(fin.replace('T', '')) : null };
    });
    try {
      const r = await api('/api/tournaments/' + $('rT').value + '/results', 'PUT', { results: rows });
      toast('Saved ' + r.count + ' results'); loadSeason();
    } catch (e) { toast(e.message, true); }
  };
}

function renderRoster(el) {
  const inSeason = new Set(REPORT.roster.map((p) => p.id));
  const tocc = new Set(REPORT.toccMembers.map((e) => e.participantId));
  el.innerHTML =
    '<div class="card"><h2>Add participant</h2><p class="muted">They\\'ll be emailed a link to set their own password.</p><div class="row">' +
      '<input id="npName" placeholder="Name"><input id="npNick" placeholder="Nickname (optional)"><input id="npEmail" placeholder="email@example.com">' +
      '<button class="act" id="npGo">Add</button></div></div>' +
    '<div class="card"><h2>Season roster</h2><p class="muted">Nickname is what other participants see instead of Name.</p><table>' +
      '<tr><th>Name</th><th>Nickname</th><th>Email</th><th>In season</th><th>TOCC</th></tr>' +
      STATE.participants.map((p) => '<tr><td><input data-name="' + p.id + '" value="' + esc(p.name) +
        '" style="width:120px"></td><td><input data-nick="' + p.id +
        '" value="' + esc(p.nickname || '') + '" style="width:120px"></td><td><input data-email="' + p.id +
        '" value="' + esc(p.email) + '" style="width:180px"></td><td><input type="checkbox" data-in="' + p.id + '"' + (inSeason.has(p.id) ? ' checked' : '') +
        '></td><td><input type="checkbox" data-tocc="' + p.id + '"' + (tocc.has(p.id) ? ' checked' : '') +
        (inSeason.has(p.id) ? '' : ' disabled') + '></td></tr>').join('') + '</table></div>';

  $('npGo').onclick = async () => {
    try {
      await api('/api/participants', 'POST', { name: $('npName').value, nickname: $('npNick').value, email: $('npEmail').value });
      toast('Participant added and emailed a password-setup link'); STATE = await api('/api/state'); render();
    } catch (e) { toast(e.message, true); }
  };
  const save = async (id, inS, isT) => {
    if (!inS) return toast('Remove-from-season is not wired yet — untick TOCC instead', true);
    try {
      await api('/api/seasons/' + SEASON.id + '/roster', 'POST', { participantId: id, isTOCCMember: isT });
      toast('Roster updated'); loadSeason();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-in]').forEach((c) => {
    c.onclick = () => save(c.dataset.in, c.checked, tocc.has(c.dataset.in));
  });
  el.querySelectorAll('[data-nick]').forEach((inp) => {
    inp.onchange = async () => {
      try {
        await api('/api/participants/' + inp.dataset.nick + '/nickname', 'PUT', { nickname: inp.value });
        toast('Nickname saved'); STATE = await api('/api/state');
      } catch (e) { toast(e.message, true); }
    };
  });
  el.querySelectorAll('[data-name]').forEach((inp) => {
    inp.onchange = async () => {
      try {
        await api('/api/participants/' + inp.dataset.name, 'PUT', { name: inp.value });
        toast('Name saved'); STATE = await api('/api/state');
      } catch (e) { toast(e.message, true); inp.value = STATE.participants.find((p) => p.id === inp.dataset.name).name; }
    };
  });
  el.querySelectorAll('[data-email]').forEach((inp) => {
    inp.onchange = async () => {
      try {
        await api('/api/participants/' + inp.dataset.email, 'PUT', { email: inp.value });
        toast('Email saved'); STATE = await api('/api/state');
      } catch (e) { toast(e.message, true); inp.value = STATE.participants.find((p) => p.id === inp.dataset.email).email; }
    };
  });
  el.querySelectorAll('[data-tocc]').forEach((c) => {
    c.onclick = () => save(c.dataset.tocc, true, c.checked);
  });
}

function renderSeasons(el) {
  el.innerHTML =
    '<div class="card"><h2>Spin up a test league</h2>' +
      '<p class="muted">Runs from today through the end of this year, fully isolated from real money.</p>' +
      '<div class="row"><label class="muted"><input type="checkbox" id="tlCopy" checked> copy current roster</label>' +
      '<button class="act" id="tlGo">Create test league</button></div></div>' +
    '<div class="card"><h2>New league</h2><div class="row">' +
      '<input id="lgName" placeholder="League name"><button class="act" id="lgGo">Create</button></div></div>' +
    '<div class="card"><h2>Seasons</h2><table><tr><th>League</th><th>Year</th><th>Status</th><th></th></tr>' +
      STATE.seasons.map((s) => {
        const lg = STATE.leagues.find((l) => l.id === s.leagueId) || {};
        return '<tr><td>' + esc(lg.name) + (lg.isTest ? ' <span class="pill test">test</span>' : '') +
          '</td><td>' + s.year + '</td><td>' +
          '<select data-st="' + s.id + '">' + ['DRAFT','ACTIVE','COMPLETE'].map((x) =>
            '<option' + (x === s.status ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' +
          '</td><td><button class="act ghost" data-roll="' + s.id + '">Roll to ' + (s.year + 1) + '</button></td></tr>';
      }).join('') + '</table>' +
      '<p class="muted">Rolling over creates a fresh season with the same roster and rules. ' +
      'Prior seasons keep all their tournaments, picks and results — the one-and-done pool resets.</p></div>' +
    '<div class="card"><h2>Add season to a league</h2><div class="row">' +
      '<select id="snLg">' + STATE.leagues.map((l) => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('') + '</select>' +
      '<input id="snYr" type="number" value="' + new Date().getFullYear() + '" style="width:100px">' +
      '<button class="act" id="snGo">Create season</button></div></div>';

  $('tlGo').onclick = async () => {
    try {
      await api('/api/test-league', 'POST',
        { copyRosterFromSeasonId: ($('tlCopy').checked && SEASON) ? SEASON.id : null });
      toast('Test league created'); bootAdmin();
    } catch (e) { toast(e.message, true); }
  };
  $('lgGo').onclick = async () => {
    try { await api('/api/leagues', 'POST', { name: $('lgName').value }); toast('League created'); bootAdmin(); }
    catch (e) { toast(e.message, true); }
  };
  $('snGo').onclick = async () => {
    try {
      await api('/api/seasons', 'POST', { leagueId: $('snLg').value, year: Number($('snYr').value) });
      toast('Season created'); bootAdmin();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-roll]').forEach((b) => {
    b.onclick = async () => {
      try { await api('/api/seasons/' + b.dataset.roll + '/roll-over', 'POST', {}); toast('New season created'); bootAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
  el.querySelectorAll('[data-st]').forEach((s) => {
    s.onchange = async () => {
      try { await api('/api/seasons/' + s.dataset.st + '/status', 'POST', { status: s.value }); toast('Status updated'); bootAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

boot().catch((e) => toast(e.message, true));
</script>
</body>
</html>`;
