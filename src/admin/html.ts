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
  .gbox { background:var(--panel); border:1px solid var(--line); border-radius:10px; margin-bottom:8px; overflow:hidden; }
  .gbox.current { border-color:var(--accent); }
  .gbox-head { padding:10px 14px; cursor:pointer; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .gbox-head:hover { background:#101713; }
  .gbox-name { font-weight:600; }
  .gbox-body { display:none; padding:0 14px 14px; border-top:1px solid var(--line); }
  .gbox.open .gbox-body { display:block; }
  .gbox h4 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:14px 0 6px; font-weight:600; }
  .gbox-avail { font-size:13px; margin:3px 0; }
  .tbox { background:var(--panel); border:1px solid var(--line); border-radius:10px; margin-bottom:12px; overflow:hidden; }
  .tbox-head { padding:14px 16px; cursor:pointer; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .tbox-head.disabled { cursor:default; }
  .tbox-head:not(.disabled):hover { background:#101713; }
  .tbox-name { font-weight:700; font-size:16px; }
  .tbox-body { display:none; padding:0 12px 12px; border-top:1px solid var(--line); }
  .tbox.open .tbox-body { display:block; }
  .sortbtn { padding:4px 10px; font-size:12px; }
  .sortbtn.on { background:var(--accent); border-color:var(--accent); color:#08150d; }
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
  <nav>
    <button data-tab="standings" class="on">Standings</button>
    <button data-tab="mypicks">My Picks</button>
    <button data-tab="myhearn">Hearn Picks</button>
    <button data-tab="picks" data-admin>Picks</button>
    <button data-tab="hearn" data-admin>Hearn Lists</button>
    <button data-tab="schedule" data-admin>Schedule</button>
    <button data-tab="results" data-admin>Results</button>
    <button data-tab="roster" data-admin>Roster</button>
    <button data-tab="seasons" data-admin>Seasons</button>
    <button data-tab="emails" data-admin>Emails</button>
    <button data-tab="settings" style="margin-left:auto">Settings</button>
  </nav>
</header>
<main>
  <section id="standings" class="on"></section>
  <section id="mypicks"></section>
  <section id="myhearn"></section>
  <section id="picks"></section>
  <section id="hearn"></section>
  <section id="schedule"></section>
  <section id="results"></section>
  <section id="roster"></section>
  <section id="seasons"></section>
  <section id="emails"></section>
  <section id="settings"></section>
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
// League-wide "how contested is this golfer" — % of the roster who have NOT
// used them in a previous week. Only shown when the field actually carries
// it (today: just the current-week pick dropdown) — shown at every value,
// 100% included, so it's visible at a glance that the number is live.
const availLabel = (pct) => (pct == null ? '' : ' · ' + pct + '% avail');

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
      const label = esc(g.name) + esc(oddsLabel(g.odds)) + esc(availLabel(g.availabilityPct)) + (isUsed ? ' (used)' : '');
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
  if (tab === 'standings') return renderStandingsTab(el);
  if (tab === 'myhearn') return renderMyHearnTab(el);
  if (tab === 'settings') return renderSettingsTab(el);
  if (!REPORT && tab !== 'seasons') {
    el.innerHTML = '<div class="card"><p class="muted">No season selected. Create one in the Seasons tab.</p></div>';
    return;
  }
  ({ picks: renderPicks, hearn: renderHearn, schedule: renderSchedule,
     results: renderResults, roster: renderRoster, seasons: renderSeasons, emails: renderEmails })[tab](el);
}

// ---- shared standings/pots rendering (used by My Picks and the admin Dashboard) ----

function standingsTable(rows, report, payoutRows) {
  if (!rows || !rows.length) return '<p class="muted">No results yet.</p>';
  const payoutByParticipant = {};
  (payoutRows || []).forEach((p) => { payoutByParticipant[p.participantId] = p.amount; });
  const showPayout = (payoutRows || []).length > 0;
  return '<table><tr><th>#</th><th>Participant</th><th class="num">Earnings</th>' +
    (showPayout ? '<th class="num">Payout</th>' : '') + '</tr>' +
    rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(pname(r.participantId, report)) +
      '</td><td class="num">' + money(r.totalEarnings) + '</td>' +
      (showPayout ? '<td class="num">' + (payoutByParticipant[r.participantId] ? money(payoutByParticipant[r.participantId]) : '') + '</td>' : '') +
      '</tr>').join('') + '</table>';
}

function potsCardsHtml(report, season, tournaments, showTocc) {
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
    (showTocc
      ? '<div class="card"><h2>TOCC Side Action</h2>' +
        '<p class="muted">' + money(season.toccStake) + '/wk, ' + money(season.toccStakeIfWinner) + ' if the pick wins outright</p>' +
        '<table><tr><th>Participant</th><th class="num">Net</th></tr>' +
        Object.entries(tocc.netByParticipant).sort((a,b) => b[1] - a[1])
          .map(([id, net]) => '<tr><td>' + esc(pname(id, report)) + '</td><td class="num" style="color:' +
            (net >= 0 ? 'var(--accent)' : 'var(--bad)') + '">' + money(net) + '</td></tr>').join('') +
        '</table></div>'
      : '')
  );
}

// ---- Standings (every logged-in participant) --------------------------------

function renderStandingsTab(el) {
  if (!MY.season) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(MY.failureMessage || 'No active season.') + '</p></div>';
    return;
  }

  const picksTable = MY.myPicks.length
    ? '<table><tr><th>Week</th><th>Golfer</th><th>Source</th></tr>' +
      MY.myPicks.map((p) => '<tr><td>' + esc(p.tournamentName) + '</td><td>' + esc(p.golferName) +
        '</td><td class="' + (p.source === 'hearn' ? 'hearn' : 'muted') + '">' + esc(p.source) + '</td></tr>').join('') +
      '</table>'
    : '<p class="muted">No picks yet this season.</p>';

  const q = MY.report.quarterStandings || {};
  const pot = MY.report.payouts || { totalPot: 0, overall: [], quarters: {} };
  el.innerHTML =
    '<div class="card"><h2>Season Standings</h2>' +
      (pot.totalPot ? '<p class="muted">Total pot: ' + money(pot.totalPot) + '</p>' : '') +
      standingsTable(MY.report.seasonStandings, MY.report, pot.overall) + '</div>' +
    '<div class="grid2">' + [1,2,3,4].map((n) =>
      '<div class="card"><h2>Quarter ' + n + '</h2>' + standingsTable(q[n], MY.report, pot.quarters[n]) + '</div>').join('') + '</div>' +
    '<div class="grid2">' + potsCardsHtml(MY.report, MY.season, MY.tournaments, ME.id in MY.report.tocc.netByParticipant) + '</div>' +
    '<div class="card"><h2>Your picks this season</h2>' + picksTable + '</div>';
}

// ---- Settings (every logged-in participant) --------------------------------

function renderSettingsTab(el) {
  el.innerHTML =
    '<div class="card"><h2>Nickname</h2>' +
      '<p class="muted">Shown to other participants instead of your real name.</p>' +
      '<div class="row"><input id="nickInput" placeholder="Your nickname" style="width:200px" value="' + esc(ME.nickname || '') + '">' +
      '<button class="act ghost" id="nickGo">Save</button></div>' +
    '</div>' +
    '<div class="card"><h2>Password</h2>' +
      '<button class="act ghost" id="pwToggle">Change password</button>' +
      '<div class="row" id="pwBox" style="display:none;margin-top:10px">' +
        '<input id="pwCurrent" type="password" placeholder="Current password" autocomplete="current-password" style="width:200px">' +
        '<input id="pwNew" type="password" placeholder="New password (min 8 chars)" autocomplete="new-password" style="width:220px">' +
        '<button class="act" id="pwGo">Save</button>' +
      '</div>' +
    '</div>' +
    '<div class="card"><h2>Session</h2>' +
      '<button class="act ghost" id="logoutBtn">Log out</button>' +
    '</div>';

  $('nickGo').onclick = async () => {
    try {
      ME = { ...ME, ...(await api('/api/my/nickname', 'PUT', { nickname: $('nickInput').value })) };
      toast('Nickname saved'); await loadMyState(); if (ME.isAdmin) await loadSeason(); render();
    } catch (e) { toast(e.message, true); }
  };

  $('pwToggle').onclick = () => {
    const box = $('pwBox');
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
  };
  $('pwGo').onclick = async () => {
    const currentPassword = $('pwCurrent').value;
    const newPassword = $('pwNew').value;
    if (newPassword.length < 8) return toast('New password must be at least 8 characters', true);
    try {
      await api('/api/my/password', 'PUT', { currentPassword, newPassword });
      $('pwCurrent').value = ''; $('pwNew').value = ''; $('pwBox').style.display = 'none';
      toast('Password changed');
    } catch (e) { toast(e.message, true); }
  };

  $('logoutBtn').onclick = async () => {
    try { await api('/api/auth/logout', 'POST', {}); } catch { /* ignore */ }
    location.reload();
  };
}

// ---- My Picks (every logged-in participant) — pure picking UI --------------

function finishLabel(fp) {
  return fp === null ? 'MC' : '#' + fp;
}

function golferHistoryRows(starts) {
  if (!starts || !starts.length) return '<p class="muted">None found.</p>';
  return '<table><tr><th>Date</th><th>Tournament</th><th>Place</th></tr>' +
    starts.map((s) => '<tr><td>' + new Date(s.date).toLocaleDateString() + '</td><td>' + esc(s.eventName) +
      '</td><td>' + finishLabel(s.finishPosition) + '</td></tr>').join('') + '</table>';
}

function availabilityLineHtml(label, a) {
  if (!a) return '<p class="gbox-avail muted">' + esc(label) + ': not applicable yet (season needs 4+ weeks for quarters)</p>';
  if (a.total === 0) return '<p class="gbox-avail muted">' + esc(label) + ': nobody there yet</p>';
  return '<p class="gbox-avail">' + esc(label) + ': available in <strong>' + a.available + ' of ' + a.total + '</strong> entries</p>';
}

function golferBoxHtml(g, isCurrent, currentQuarter) {
  const isUsed = Boolean(g.usedInTournament);
  return '<div class="gbox' + (isCurrent ? ' current' : '') + '" data-gname="' + esc(g.name) + '" data-sort-name="' + esc(g.name) + '" data-sort-odds="' + (g.odds == null ? '' : g.odds) + '">' +
    '<div class="gbox-head" data-toggle="' + esc(g.name) + '">' +
      '<span class="gbox-name"' + (isUsed ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' + esc(g.name) + '</span>' +
      '<span class="muted">' + esc(oddsLabel(g.odds)) + '</span>' +
      (isCurrent ? '<span class="pill" style="color:var(--accent);border-color:var(--accent)">current pick</span>' : '') +
      (isUsed ? '<span class="pill" style="color:var(--bad);border-color:var(--bad)">used</span>' : '') +
      '<span class="muted" style="margin-left:auto">' + g.availability.available + '/' + g.availability.total + ' avail</span>' +
    '</div>' +
    '<div class="gbox-body">' +
      (isUsed
        ? '<p class="muted">You already used this golfer for the ' + esc(g.usedInTournament) + ' — one-and-done.</p>'
        : '<button class="act" data-choose="' + esc(g.name) + '">' + (isCurrent ? 'Keep this pick' : 'Choose this player') + '</button>') +
      '<h4>Recent Results (last 5 starts)</h4>' + golferHistoryRows(g.recentStarts) +
      '<h4>Course History</h4>' + golferHistoryRows(g.courseHistory) +
      '<h4>Opponent Availability</h4>' +
      availabilityLineHtml('League-wide', g.availability) +
      availabilityLineHtml('Ahead of you overall', g.aheadOverallAvailability) +
      availabilityLineHtml('Ahead of you in Quarter ' + (currentQuarter || '?'), g.aheadQuarterAvailability) +
    '</div>' +
  '</div>';
}

function tournamentBoxHtml(t) {
  const pill = t.quarterPill ? '<span class="pill">' + esc(t.quarterPill) + '</span>' : '';
  const pickNote = t.existingPickGolferName
    ? ' · Current pick: <strong>' + esc(t.existingPickGolferName) + '</strong>'
    : (t.hasField ? ' · <span class="pill" style="color:var(--warn);border-color:var(--warn)">No pick — due ' + new Date(t.startTime).toLocaleString() + '</span>' : '');
  const head =
    '<div class="tbox-head' + (t.hasField ? '' : ' disabled') + '"' + (t.hasField ? ' data-ttoggle="' + esc(t.id) + '"' : '') + '>' +
      '<span class="tbox-name">' + esc(t.name) + '</span>' + pill +
      '<span class="muted" style="margin-left:auto">' + new Date(t.startTime).toLocaleDateString() + pickNote + '</span>' +
    '</div>';
  if (!t.hasField) {
    return '<div class="tbox">' + head + '<p class="muted" style="padding:6px 14px 14px">Field not set yet — check back closer to the tournament.</p></div>';
  }
  const sortBar =
    '<div class="row" style="padding:12px 14px 0"><span class="muted" style="font-size:12px">Sort:</span>' +
      '<button class="act ghost sortbtn" data-sort="name">A–Z</button>' +
      '<button class="act ghost sortbtn on" data-sort="odds">Odds</button>' +
    '</div>';
  const byOdds = t.field.slice().sort((a, b) => {
    if (a.odds == null && b.odds == null) return a.name.localeCompare(b.name);
    if (a.odds == null) return 1;
    if (b.odds == null) return -1;
    return a.odds - b.odds;
  });
  const body = byOdds.map((g) => golferBoxHtml(g, g.name === t.existingPickGolferName, t.quarterNumber)).join('');
  return '<div class="tbox" data-tid="' + esc(t.id) + '">' + head + '<div class="tbox-body">' + sortBar + '<div class="field-list">' + body + '</div></div></div>';
}

function sortFieldList(container, mode) {
  const nodes = Array.from(container.children);
  nodes.sort((a, b) => {
    if (mode === 'odds') {
      const ao = a.dataset.sortOdds, bo = b.dataset.sortOdds;
      if (ao === '' && bo === '') return a.dataset.sortName.localeCompare(b.dataset.sortName);
      if (ao === '') return 1;
      if (bo === '') return -1;
      return Number(ao) - Number(bo);
    }
    return a.dataset.sortName.localeCompare(b.dataset.sortName);
  });
  nodes.forEach((n) => container.appendChild(n));
}

function renderMyPicksTab(el) {
  if (!MY.season) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(MY.failureMessage || 'No active season.') + '</p></div>';
    return;
  }

  const tournaments = MY.upcomingTournaments || [];
  if (!tournaments.length) {
    el.innerHTML = '<div class="card"><p class="muted">No upcoming tournaments to pick right now.</p></div>';
    return;
  }

  el.innerHTML = tournaments.map((t, i) => tournamentBoxHtml(t)).join('');

  el.querySelectorAll('[data-ttoggle]').forEach((head) => {
    head.onclick = () => head.closest('.tbox').classList.toggle('open');
  });
  el.querySelectorAll('[data-toggle]').forEach((head) => {
    head.onclick = (e) => { e.stopPropagation(); head.closest('.gbox').classList.toggle('open'); };
  });
  el.querySelectorAll('.sortbtn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const bar = btn.closest('.row');
      bar.querySelectorAll('.sortbtn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      sortFieldList(bar.nextElementSibling, btn.dataset.sort);
    };
  });
  el.querySelectorAll('[data-choose]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const tournamentId = btn.closest('.tbox').dataset.tid;
      try {
        const r = await api('/api/my/pick', 'POST', { tournamentId, golferName: btn.dataset.choose });
        toast(r.message, !r.ok);
        if (r.ok) { await loadMyState(); render(); }
      } catch (e) { toast(e.message, true); }
    };
  });
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
  const pool = MY.hearnPool && MY.hearnPool.length ? MY.hearnPool : ((MY.upcomingTournaments && MY.upcomingTournaments[0]) ? MY.upcomingTournaments[0].field : []);
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

async function renderPicks(el) {
  const picks = await api('/api/seasons/' + SEASON.id + '/picks');
  const tOpts = REPORT.tournaments.map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
  const pOpts = REPORT.roster.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  el.innerHTML =
    '<div class="card"><h2>Enter / override a pick</h2><div class="row">' +
      '<select id="pkT">' + tOpts + '</select><select id="pkP">' + pOpts + '</select>' +
      '<select id="pkG" style="min-width:200px"></select>' +
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

  const refreshPkG = () => {
    const names = (REPORT.fields[$('pkT').value] || []).map((n) => ({ name: n, odds: null }));
    $('pkG').innerHTML = golferOptionsHtml(names, [], '');
  };
  refreshPkG();
  $('pkT').onchange = refreshPkG;

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
  Object.values(byP).forEach((hs) => hs.sort((a, b) => a.rank - b.rank));

  const pOpts = REPORT.roster.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  const golferPool = (REPORT.golfers || []).map((n) => ({ name: n, odds: null }));

  el.innerHTML =
    '<div class="card"><h2>Set a Hearn pick</h2><p class="muted">Ordered fallback used when someone forgets to pick — picks a slot for one participant at a time. Struck-through golfers below are already used this season and will be skipped.</p>' +
      '<div class="row">' +
        '<select id="hnP">' + pOpts + '</select>' +
        '<select id="hnSlot"></select>' +
        '<select id="hnG" style="min-width:200px"></select>' +
        '<button class="act" id="hnGo">Save</button>' +
      '</div></div>' +
    REPORT.roster.map((p) => {
      const hs = byP[p.id] || [];
      return '<div class="card"><h2>' + esc(p.name) + '</h2>' +
        (hs.length ? '<p>' + hs.map((h) => '<span class="' + (h.isDead ? 'dead' : '') + '">' +
          h.rank + '. ' + esc(h.golferName) + '</span>').join(' &nbsp;·&nbsp; ') + '</p>'
          : '<p class="muted">No Hearn list — they take a zero if they forget.</p>') +
        '</div>';
    }).join('');

  const refreshGolfer = () => {
    const hs = byP[$('hnP').value] || [];
    const rank = Number($('hnSlot').value);
    const existing = hs.find((h) => h.rank === rank);
    $('hnG').innerHTML = golferOptionsHtml(golferPool, existing ? [existing.golferName] : [], existing ? existing.golferName : '');
  };
  const refreshSlots = () => {
    const hs = byP[$('hnP').value] || [];
    const opts = [];
    for (let rank = 1; rank <= hs.length + 1; rank++) {
      const existing = hs.find((h) => h.rank === rank);
      opts.push('<option value="' + rank + '">' + rank + (existing ? ' (' + esc(existing.golferName) + ')' : ' (new)') + '</option>');
    }
    $('hnSlot').innerHTML = opts.join('');
    refreshGolfer();
  };
  $('hnP').onchange = refreshSlots;
  $('hnSlot').onchange = refreshGolfer;
  refreshSlots();

  $('hnGo').onclick = async () => {
    const pid = $('hnP').value;
    const rank = Number($('hnSlot').value);
    const golferName = $('hnG').value;
    if (!golferName) return toast('Pick a golfer', true);
    const hs = byP[pid] || [];
    const names = [];
    for (let i = 1; i <= Math.max(hs.length, rank); i++) {
      names.push(i === rank ? golferName : (hs.find((h) => h.rank === i) || {}).golferName || '');
    }
    try {
      await api('/api/seasons/' + SEASON.id + '/hearn/' + pid, 'PUT', { golferNames: names });
      toast('Hearn pick saved'); render();
    } catch (e) { toast(e.message, true); }
  };
}

function renderSchedule(el) {
  // Quarters 1-3's last tournament gets a "last of QN" pill; quarter 4's last
  // is always the finale already, which has its own obvious pill.
  const lastOfQuarter = {};
  (REPORT.quarterBoundaries || []).forEach((b) => {
    if (b.quarter < 4) lastOfQuarter[b.lastSequence] = b.quarter;
  });

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
        (t.isSeasonFinale ? ' <span class="pill">finale</span>' : '') +
        (lastOfQuarter[t.sequence] ? ' <span class="pill">last of Q' + lastOfQuarter[t.sequence] + '</span>' : '') +
        '</td><td>' +
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
  const moneyRulesCard = (() => {
    if (!SEASON || !REPORT) return '';
    const pot = REPORT.payouts || { totalPot: 0 };
    const dollarsPerPlace = (schedule) => schedule.slice().sort((a, b) => a.place - b.place)
      .map((p) => Math.round(p.pct * pot.totalPot)).join('\\n');
    const lg = STATE.leagues.find((l) => l.id === SEASON.leagueId) || {};
    return '<div class="card"><h2>Money rules — ' + esc(lg.name || '') + ' ' + SEASON.year + '</h2>' +
      '<p class="muted">Overall/Quarter payouts: dollar amount per place (1st first, one per line). Stored as a % of ' +
      'the total pot (buy-in \\u00d7 roster size), so they auto-scale if the roster size changes — re-entered here in ' +
      'today\\'s dollars against today\\'s roster of ' + REPORT.roster.length + '.</p>' +
      '<div class="row">' +
        '<label class="muted">Greller/wk<br><input id="mrGreller" type="number" value="' + SEASON.grellerWeeklyContribution + '" style="width:80px"></label>' +
        '<label class="muted">Missed cut fine<br><input id="mrMC" type="number" value="' + SEASON.missedCutFine + '" style="width:80px"></label>' +
        '<label class="muted">TOCC stake<br><input id="mrTocc" type="number" value="' + SEASON.toccStake + '" style="width:80px"></label>' +
        '<label class="muted">TOCC if winner<br><input id="mrToccW" type="number" value="' + SEASON.toccStakeIfWinner + '" style="width:80px"></label>' +
        '<label class="muted">Buy-in<br><input id="mrBuyIn" type="number" value="' + SEASON.buyIn + '" style="width:80px"></label>' +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
        '<label class="muted">Overall payouts ($)<br><textarea id="mrOverall" style="width:120px;height:70px">' +
          esc(dollarsPerPlace(SEASON.overallPayouts)) + '</textarea></label>' +
        '<label class="muted">Quarter payouts ($, each quarter)<br><textarea id="mrQuarter" style="width:120px;height:70px">' +
          esc(dollarsPerPlace(SEASON.quarterPayouts)) + '</textarea></label>' +
      '</div>' +
      '<p class="muted">Total pot right now: ' + money(pot.totalPot) + '</p>' +
      '<div class="row" style="margin-top:8px"><button class="act" id="mrGo">Save money rules</button></div></div>';
  })();

  el.innerHTML =
    moneyRulesCard +
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

  if ($('mrGo')) {
    $('mrGo').onclick = async () => {
      const buyIn = Number($('mrBuyIn').value) || 0;
      const rosterSize = REPORT.roster.length;
      const pot = buyIn * rosterSize;
      const toSchedule = (textareaId) => $(textareaId).value.split('\\n')
        .map((line) => line.trim()).filter((line) => line.length > 0)
        .map((line, i) => ({ place: i + 1, pct: pot > 0 ? Number(line) / pot : 0 }));
      try {
        await api('/api/seasons/' + SEASON.id + '/rules', 'PUT', {
          grellerWeeklyContribution: Number($('mrGreller').value),
          missedCutFine: Number($('mrMC').value),
          toccStake: Number($('mrTocc').value),
          toccStakeIfWinner: Number($('mrToccW').value),
          buyIn,
          overallPayouts: toSchedule('mrOverall'),
          quarterPayouts: toSchedule('mrQuarter'),
        });
        toast('Money rules saved'); loadSeason();
      } catch (e) { toast(e.message, true); }
    };
  }
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

// ---- Emails (admin) ---------------------------------------------------------

function emailTournamentSelectHtml(type, selectedId) {
  return '<select data-etour="' + type + '">' +
    REPORT.tournaments.map((t) => '<option value="' + t.id + '"' + (t.id === selectedId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
    '</select>';
}

function renderEmails(el) {
  const defaultTid = REPORT.openTournamentId || (REPORT.tournaments[0] && REPORT.tournaments[0].id) || '';
  const rows = [
    { type: 'PICK_REMINDER', label: 'Pick Reminder', desc: "Emails everyone on the roster who hasn't picked yet for the selected tournament." },
    { type: 'PICKS_DIGEST', label: 'Picks Digest', desc: "Whole roster \\u2014 everyone's pick for the selected tournament, with Greller Alert!! tags." },
    { type: 'TOCC_PICKS_ANNOUNCEMENT', label: 'TOCC Picks Announcement', desc: "TOCC members only \\u2014 everyone's pick, with SOLO! tags." },
    { type: 'RESULTS_DIGEST', label: 'Results Digest', desc: "Whole roster \\u2014 everyone's pick and how it finished. Requires results already posted." },
    { type: 'TOCC_ROUND_UPDATE', label: 'TOCC Round Update', desc: "TOCC members only \\u2014 live standings pulled from DataGolf right now (round 4+ includes an estimated payout)." },
  ];

  el.innerHTML =
    '<div class="card"><h2>Service emails</h2>' +
    '<p class="muted">Each button sends that email immediately for the selected tournament, using current data \\u2014 separate from (and doesn\\'t interfere with) the automatic schedule.</p>' +
    rows.map((r) =>
      '<div class="row" style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">' +
        '<div style="flex:1;min-width:220px"><strong>' + esc(r.label) + '</strong><br><span class="muted">' + r.desc + '</span></div>' +
        emailTournamentSelectHtml(r.type, defaultTid) +
        '<button class="act ghost" data-esend="' + r.type + '">Send now</button>' +
      '</div>'
    ).join('') +
    '</div>' +
    '<div class="card"><h2>Message participants</h2>' +
      '<div class="row"><input id="bcSubject" placeholder="Subject" style="flex:1;min-width:220px"></div>' +
      '<textarea id="bcMessage" placeholder="Message"></textarea>' +
      '<div class="row" style="margin-top:8px"><label class="muted"><input type="checkbox" id="bcAll" checked> Send to entire roster</label></div>' +
      '<div id="bcSubset" class="row" style="display:none">' +
        REPORT.roster.map((p) => '<label class="muted" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-bcp="' + p.id + '"> ' + esc(p.nickname || p.name) + '</label>').join('') +
      '</div>' +
      '<div class="row" style="margin-top:8px"><button class="act" id="bcGo">Send message</button></div>' +
    '</div>';

  el.querySelectorAll('[data-esend]').forEach((b) => {
    b.onclick = async () => {
      const type = b.dataset.esend;
      const tournamentId = el.querySelector('[data-etour="' + type + '"]').value;
      if (!tournamentId) return toast('No tournament selected', true);
      b.disabled = true;
      try {
        const r = await api('/api/admin/emails/send', 'POST', { type, tournamentId });
        toast('Sent to ' + r.sent + (r.sent === 1 ? ' person' : ' people') + (r.round ? ' (round ' + r.round + ')' : ''));
      } catch (e) { toast(e.message, true); }
      b.disabled = false;
    };
  });

  $('bcAll').onchange = () => { $('bcSubset').style.display = $('bcAll').checked ? 'none' : 'flex'; };
  $('bcGo').onclick = async () => {
    const subject = $('bcSubject').value.trim();
    const message = $('bcMessage').value.trim();
    if (!subject || !message) return toast('Subject and message are required', true);
    const all = $('bcAll').checked;
    const participantIds = all ? null : [...el.querySelectorAll('[data-bcp]:checked')].map((c) => c.dataset.bcp);
    if (!all && participantIds.length === 0) return toast('Pick at least one recipient', true);
    try {
      const r = await api('/api/seasons/' + SEASON.id + '/broadcast', 'POST', { subject, message, participantIds });
      toast('Sent to ' + r.sent + (r.sent === 1 ? ' person' : ' people'));
      $('bcSubject').value = ''; $('bcMessage').value = '';
    } catch (e) { toast(e.message, true); }
  };
}

boot().catch((e) => toast(e.message, true));
</script>
</body>
</html>`;
