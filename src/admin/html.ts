/**
 * The admin single-page app, served at / on the LAN. Deliberately one
 * dependency-free string: no build step, no CDN, works on a phone browser
 * from the couch.
 */
export const ADMIN_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golf League Admin</title>
<style>
  :root { --bg:#0f1512; --panel:#18211c; --line:#2b382f; --text:#e8f0ea; --muted:#93a89a; --accent:#4ba36a; --warn:#d9a441; --bad:#d96a5a; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:14px 18px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; font-weight:650; }
  nav { display:flex; gap:4px; flex-wrap:wrap; }
  nav button { background:transparent; border:1px solid transparent; color:var(--muted); padding:6px 11px; border-radius:7px; cursor:pointer; font-size:14px; }
  nav button.on { background:var(--panel); border-color:var(--line); color:var(--text); }
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
  #toast { position:fixed; right:16px; bottom:16px; background:var(--panel); border:1px solid var(--line); padding:10px 14px; border-radius:8px; display:none; max-width:60ch; }
  .stat { font-size:24px; font-weight:650; }
</style>
</head>
<body>
<header>
  <h1>⛳ Golf League Admin</h1>
  <select id="seasonPicker"></select>
  <nav>
    <button data-tab="dash" class="on">Dashboard</button>
    <button data-tab="picks">Picks</button>
    <button data-tab="hearn">Hearn Lists</button>
    <button data-tab="schedule">Schedule</button>
    <button data-tab="results">Results</button>
    <button data-tab="roster">Roster</button>
    <button data-tab="seasons">Seasons</button>
  </nav>
</header>
<main>
  <section id="dash" class="on"></section>
  <section id="picks"></section>
  <section id="hearn"></section>
  <section id="schedule"></section>
  <section id="results"></section>
  <section id="roster"></section>
  <section id="seasons"></section>
</main>
<div id="toast"></div>
<script>
const token = new URLSearchParams(location.search).get('token');
const $ = (id) => document.getElementById(id);
let STATE = null, SEASON = null, REPORT = null;

function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderColor = bad ? 'var(--bad)' : 'var(--line)';
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 3200);
}
async function api(path, method, body) {
  const url = path + (token ? (path.includes('?') ? '&' : '?') + 'token=' + token : '');
  const res = await fetch(url, {
    method: method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const money = (n) => '$' + Math.round(n).toLocaleString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pname = (id) => (REPORT && REPORT.nameByParticipantId[id]) || id;

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === b.dataset.tab));
    render();
  };
});

async function boot() {
  STATE = await api('/api/state');
  const sel = $('seasonPicker');
  sel.innerHTML = STATE.seasons.map((s) => {
    const lg = STATE.leagues.find((l) => l.id === s.leagueId);
    return '<option value="' + s.id + '">' + esc((lg ? lg.name : '?') + ' — ' + s.year + ' (' + s.status + ')') + '</option>';
  }).join('') || '<option value="">No seasons yet</option>';
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
  if (!REPORT && tab !== 'seasons') {
    el.innerHTML = '<div class="card"><p class="muted">No season selected. Create one in the Seasons tab.</p></div>';
    return;
  }
  ({ dash: renderDash, picks: renderPicks, hearn: renderHearn, schedule: renderSchedule,
     results: renderResults, roster: renderRoster, seasons: renderSeasons })[tab](el);
}

function standingsTable(rows) {
  if (!rows || !rows.length) return '<p class="muted">No results yet.</p>';
  return '<table><tr><th>#</th><th>Participant</th><th class="num">Earnings</th></tr>' +
    rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(pname(r.participantId)) +
      '</td><td class="num">' + money(r.totalEarnings) + '</td></tr>').join('') + '</table>';
}

function renderDash(el) {
  const q = REPORT.quarterStandings || {};
  const sp = REPORT.sidePot1, gr = REPORT.greller, tocc = REPORT.tocc;
  el.innerHTML =
    '<div class="card"><h2>Season Standings</h2>' + standingsTable(REPORT.seasonStandings) + '</div>' +
    '<div class="grid2">' + [1,2,3,4].map((n) =>
      '<div class="card"><h2>Quarter ' + n + '</h2>' + standingsTable(q[n]) + '</div>').join('') + '</div>' +
    '<div class="grid2">' +
      '<div class="card"><h2>Side Pot 1 — Most Top 10s</h2>' +
        '<p class="stat">' + money(sp.balance) + '</p>' +
        '<p class="muted">Funded by ' + money(SEASON.missedCutFine) + ' missed-cut fines</p>' +
        '<table><tr><th>Participant</th><th class="num">T10</th><th class="num">T5</th><th class="num">Wins</th></tr>' +
        sp.tallies.sort((a,b) => b.top10s - a.top10s || b.top5s - a.top5s || b.wins - a.wins)
          .map((t) => '<tr><td>' + esc(pname(t.participantId)) + '</td><td class="num">' + t.top10s +
            '</td><td class="num">' + t.top5s + '</td><td class="num">' + t.wins + '</td></tr>').join('') +
        '</table></div>' +
      '<div class="card"><h2>The Greller</h2>' +
        '<p class="stat">' + money(gr.currentBalance) + '</p>' +
        '<p class="muted">' + money(SEASON.grellerWeeklyContribution) + '/participant/week; won by a unique pick of the winner</p>' +
        '<table><tr><th>Week</th><th>Winner</th><th class="num">Pot after</th></tr>' +
        gr.history.map((w) => {
          const t = REPORT.tournaments.find((x) => x.id === w.tournamentId);
          return '<tr><td>' + esc(t ? t.name : w.tournamentId) + '</td><td>' +
            (w.winnerParticipantId ? esc(pname(w.winnerParticipantId)) : '<span class="muted">rollover</span>') +
            '</td><td class="num">' + money(w.potBalanceAfter) + '</td></tr>';
        }).join('') + '</table></div>' +
      '<div class="card"><h2>TOCC Side Action</h2>' +
        '<p class="muted">' + money(SEASON.toccStake) + '/wk, ' + money(SEASON.toccStakeIfWinner) + ' if the pick wins outright</p>' +
        '<table><tr><th>Participant</th><th class="num">Net</th></tr>' +
        Object.entries(tocc.netByParticipant).sort((a,b) => b[1] - a[1])
          .map(([id, net]) => '<tr><td>' + esc(pname(id)) + '</td><td class="num" style="color:' +
            (net >= 0 ? 'var(--accent)' : 'var(--bad)') + '">' + money(net) + '</td></tr>').join('') +
        '</table></div>' +
    '</div>';
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
    '<p class="muted">Finish of CUT/WD/MDF (or blank) counts as a missed cut and triggers the Side Pot 1 fine.</p></div>';

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
    '<div class="card"><h2>Add participant</h2><div class="row">' +
      '<input id="npName" placeholder="Name"><input id="npEmail" placeholder="email@example.com">' +
      '<button class="act" id="npGo">Add</button></div></div>' +
    '<div class="card"><h2>Season roster</h2><table>' +
      '<tr><th>Name</th><th>Email</th><th>In season</th><th>TOCC</th></tr>' +
      STATE.participants.map((p) => '<tr><td>' + esc(p.name) + '</td><td class="muted">' + esc(p.email) +
        '</td><td><input type="checkbox" data-in="' + p.id + '"' + (inSeason.has(p.id) ? ' checked' : '') +
        '></td><td><input type="checkbox" data-tocc="' + p.id + '"' + (tocc.has(p.id) ? ' checked' : '') +
        (inSeason.has(p.id) ? '' : ' disabled') + '></td></tr>').join('') + '</table></div>';

  $('npGo').onclick = async () => {
    try {
      await api('/api/participants', 'POST', { name: $('npName').value, email: $('npEmail').value });
      toast('Participant added'); STATE = await api('/api/state'); render();
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
      toast('Test league created'); boot();
    } catch (e) { toast(e.message, true); }
  };
  $('lgGo').onclick = async () => {
    try { await api('/api/leagues', 'POST', { name: $('lgName').value }); toast('League created'); boot(); }
    catch (e) { toast(e.message, true); }
  };
  $('snGo').onclick = async () => {
    try {
      await api('/api/seasons', 'POST', { leagueId: $('snLg').value, year: Number($('snYr').value) });
      toast('Season created'); boot();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-roll]').forEach((b) => {
    b.onclick = async () => {
      try { await api('/api/seasons/' + b.dataset.roll + '/roll-over', 'POST', {}); toast('New season created'); boot(); }
      catch (e) { toast(e.message, true); }
    };
  });
  el.querySelectorAll('[data-st]').forEach((s) => {
    s.onchange = async () => {
      try { await api('/api/seasons/' + s.dataset.st + '/status', 'POST', { status: s.value }); toast('Status updated'); boot(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

boot().catch((e) => toast(e.message, true));
</script>
</body>
</html>`;
