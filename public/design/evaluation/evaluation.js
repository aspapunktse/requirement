/* Shared logic and parts of the staged-evaluation proposals (#327). Every proposal is a view on the System page, so this
   file draws the page shell (crumb, hero with a ring, tabs with counts, the Overview tab, the placeholder tabs) and every
   part of the evaluation the same way: the stage tracker's data, the OG1 verdicts, the OAG Recommendations, the BSO's
   decision panel, the Risk summary, the Risk Analysis record, Documentation and the decision history. A proposal supplies
   only the layout of the Evaluation tab and the tracker in the hero and the Overview:

     EV.mount({ render(el, m) { el.innerHTML = EV.page(m, { heroExtra, tracker, evaluation }); }, afterRender(el, m) {} })

   m = EV.model(): { sys, v (the viewer), stages, idx, now, rejected, can (may decide the current gate), left, openRisks, unowned }.

   The BSO is a per-System assignment of any User, not a role. The viewer is the acting user in the app bar (#role=...,
   the 'appbar:role' event). Lena Holm is the BSO of every example System; the System's owner sees every stage but no decide
   buttons, and neither does anyone else. An Admin may act for the BSO, except on a System they own (PRD 0002 §4).
   Nothing persists: the buttons change this page only. */
(function (g) {
  const D = g.EV_DATA, doc = document;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const fmt = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const ST = D.stages, TRACKS = D.tracks, GROUPS = D.groups;

  const REC = { RECOMMEND: { label: 'Recommend', tone: 'success' }, CONDITIONS: { label: 'Recommend with conditions', tone: 'warn' }, AGAINST: { label: 'Advise against', tone: 'danger' } };
  const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const SEV_LABEL = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
  const SEV_COLOR = { CRITICAL: 'var(--bad)', HIGH: 'var(--gold)', MEDIUM: 'var(--accent)', LOW: 'var(--line)' };
  const SOURCES = { REQ: 'Requirement non-conformance', AUDIT: 'Audit finding', ADHOC: 'Ad hoc' };
  const SOURCE_SHORT = { REQ: 'Requirement', AUDIT: 'Audit finding', ADHOC: 'Ad hoc' };
  // What the BSO's choices are called at each gate (the first one is the go-ahead).
  const GO = { qual: 'Yes', og2: 'Proceed', og3: 'Authorize to operate' };
  const OUTCOME = {
    og1: { SELF: ['Self track', 'done'], FULL: ['Full track', 'warn'] },
    qual: { GO: ['Yes', 'success'], REJECT: ['Reject', 'danger'], BACK: ['Send back', 'warn'] },
    og2: { GO: ['Proceed', 'success'], REJECT: ['Reject', 'danger'], BACK: ['Send back', 'warn'] },
    og3: { GO: ['Authorized to operate', 'success'], REJECT: ['Reject', 'danger'], BACK: ['Send back', 'warn'] },
  };
  const GATE_TITLE = { og1: 'OG1: choose the Track', qual: 'Qualification', og2: 'OG2: proceed?', og3: 'OG3: authorize to operate?' };
  const ROUND_OF = { og2: 'oag1', og3: 'oag2' };
  const TABS = ['overview', 'evaluation', 'controls', 'risks', 'activity'];

  // ---------- state ----------
  const qs = new URLSearchParams(location.search);
  const ui = {
    id: D.systems.some((s) => s.id === qs.get('system')) ? qs.get('system') : 'helios',
    tab: TABS.includes(qs.get('tab')) ? qs.get('tab') : 'evaluation',
    sel: {},        // proposal A: the stage picked in the stepper, per System
    open: {},       // proposal B: stages opened by hand
    dec: {},        // the BSO's draft decision, per System
    done: {},       // a decision "recorded" in this prototype
    rec: {},        // a Recommendation form being filled in, per System and group
    given: {},      // Recommendations given in this prototype
    drawer: null,   // proposal C: the gate whose drawer is open
  };
  let renderer = null, rootEl = null;

  const sysOf = (id = ui.id) => D.systems.find((s) => s.id === id);
  const stagesOf = (sys) => (sys.track ? TRACKS[sys.track] : ['r1', 'ra1', 'og1', 'fork']);

  // ---------- the viewer ----------
  function viewer(sys) {
    const r = g.Appbar ? g.Appbar.role() : { key: 'SYSTEM_OWNER', label: 'System Owner', person: 'Marcus Lindqvist' };
    return { key: r.key, label: r.label, name: r.person, isOwner: r.person === sys.owner, isBSO: r.person === sys.bso, admin: r.key === 'ADMIN', group: r.key === 'REVIEWER' ? 'BASE' : null };
  }

  // ---------- the model ----------
  function recsOf(sys, round) {
    return ((sys.recs || {})[round] || []).map((r) => {
      const given = ui.given[`${sys.id}:${round}:${r.group}`];
      return given ? { ...r, ...given, given: true } : r;
    });
  }
  const recsFor = (sys, gate) => (ROUND_OF[gate] && sys.track === 'FULL' ? recsOf(sys, ROUND_OF[gate]) : []);
  const analysisOf = (sys, key) => sys.analyses.find((a) => a.stage === key) || null;
  const riskOf = (sys, id) => sys.risks.find((r) => r.id === id);
  const stageDocs = (sys, key) => sys.docs.filter((d) => d.stage === key && (!sys.track || d.tracks.includes(sys.track)));

  function model() {
    const sys = sysOf(), v = viewer(sys), keys = stagesOf(sys), rejected = sys.outcome === 'REJECTED';
    const idx = keys.indexOf(sys.stage);
    const stages = keys.map((k, i) => ({ key: k, ...ST[k], i, state: rejected && i === idx ? 'rejected' : i < idx ? 'done' : i === idx ? (ST[k].kind === 'end' ? 'done' : 'now') : 'todo' }));
    const now = stages[idx];
    const openRisks = sys.risks.filter((r) => r.status === 'OPEN');
    const m = { sys, v, stages, idx, now, rejected, openRisks, unowned: openRisks.filter((r) => !r.owner) };
    m.can = !rejected && now.kind === 'gate' && now.key !== 'og1' && !v.isOwner && (v.isBSO || v.admin);
    m.left = leftOf(m);
    m.counted = stages.filter((s) => s.kind !== 'end' && s.kind !== 'fork');
    return m;
  }

  // What is left in the current stage, who it waits on and what comes next
  function leftOf(m) {
    const { sys, now, stages, idx } = m, items = [];
    let waiting = '';
    if (m.rejected) return { waiting: 'Nobody', items: [`Rejected at ${now.label}. The System is closed and read-only.`], next: null };
    if (now.kind === 'round') {
      const r = now.key === 'r1' ? sys.firstRound : sys.secondRound;
      items.push(`${plural(r.total - r.done, 'Control')} without an Assessment`); waiting = `${sys.owner} (System's owner)`;
    } else if (now.kind === 'ra') {
      const a = analysisOf(sys, now.key);
      items.push(a ? `${plural(m.unowned.length, 'open Risk')} without a Risk owner` : 'Risk Analysis not recorded yet'); waiting = 'A Risk Owner';
    } else if (now.kind === 'doc') {
      const n = stageDocs(sys, now.key).filter((d) => !d.provided).length; items.push(`${plural(n, 'Document Requirement')} not provided`); waiting = `${sys.owner} (System's owner)`;
    } else if (now.kind === 'oag') {
      const p = recsOf(sys, now.key).filter((r) => !r.rec); items.push(`${plural(p.length, 'group')} yet to recommend`); waiting = p.map((r) => GROUPS[r.group].name).join(', ');
    } else if (now.key === 'og1') {
      const p = sys.og1.verdicts.filter((x) => !x.verdict); items.push(`${plural(p.length, 'group')} yet to give a verdict`); waiting = p.map((x) => GROUPS[x.group].name).join(', ');
    } else if (now.kind === 'gate') {
      items.push('Decision by the BSO'); waiting = `${sys.bso} (BSO)`;
    } else if (now.kind === 'end') {
      items.push('The System’s owner or an Admin marks it Onboarded'); waiting = `${sys.owner} (System's owner)`;
    }
    return { waiting, items, next: stages[idx + 1] || null };
  }

  // ---------- small parts ----------
  const chip = (tone, text, plain) => `<span class="chip ${tone || ''} ${plain ? 'plain' : ''}">${esc(text)}</span>`;
  const person = (n) => (n ? `<span class="who"><span class="av">${esc(initials(n))}</span>${esc(n)}</span>` : '<span class="who none"><span class="av none">?</span>No owner</span>');
  const gav = (k) => `<span class="gav" aria-hidden="true">${GROUPS[k].code}</span>`;
  const trackChip = (sys) => (sys.track === 'SELF' ? '<span class="trk self">Self track</span>' : sys.track === 'FULL' ? '<span class="trk full">Full track</span>' : '<span class="trk none">Track not chosen</span>');
  const stageChip = (m) => (m.rejected ? chip('danger', `Rejected at ${m.now.label}`) : m.now.kind === 'end' ? chip('success', 'Authorized to operate') : chip('warn', `Stage: ${m.now.label}`));
  const nodeIcon = (s) => (s.state === 'done' ? '✓' : s.state === 'rejected' ? '✕' : s.kind === 'gate' ? '' : '');

  // Self / Full strips: both Tracks, with this System's place on its own
  function tracksStrip(m) {
    const { sys } = m;
    const row = (k) => {
      const keys = TRACKS[k], mine = sys.track === k, shared = new Set(['r1', 'ra1', 'og1']);
      const items = keys.map((key, i) => {
        let st = 'off';
        if (mine) st = m.stages[i].state;
        else if (!sys.track) st = shared.has(key) ? m.stages[i].state : 'todo';
        else if (shared.has(key)) st = 'done';
        return `<li class="mini ${st} ${ST[key].kind === 'gate' ? 'gate' : ''}" title="${esc(ST[key].long)}"><i aria-hidden="true"></i><span>${esc(ST[key].label)}</span></li>`;
      }).join('');
      const note = mine ? 'This System' : sys.track ? 'Not this System’s Track' : 'Chosen at OG1';
      return `<div class="trow ${mine ? 'mine' : ''}"><div class="tname"><b>${k === 'SELF' ? 'Self' : 'Full'}</b><small>${note}</small></div><ol class="minis">${items}</ol></div>`;
    };
    return `<div class="tracks" role="group" aria-label="Both Tracks">${row('SELF')}${row('FULL')}</div>`;
  }

  // Open Risks by Risk Source (rows) and severity (columns), as the BSO sees them before deciding
  function riskSummary(m, o = {}) {
    const rs = m.openRisks, total = rs.length || 1;
    const bar = `<div class="sevbar" role="img" aria-label="Open Risks by severity">${SEVS.map((s) => { const n = rs.filter((r) => r.sev === s).length; return n ? `<i style="flex:${n};background:${SEV_COLOR[s]}" title="${SEV_LABEL[s]}: ${n}"></i>` : ''; }).join('')}</div>`;
    const sevs = `<ul class="sevkey">${SEVS.map((s) => `<li><i style="background:${SEV_COLOR[s]}"></i>${SEV_LABEL[s]} <b>${rs.filter((r) => r.sev === s).length}</b></li>`).join('')}</ul>`;
    const rows = Object.keys(SOURCES).map((k) => `<tr><th scope="row">${SOURCE_SHORT[k]}</th>${SEVS.map((s) => { const n = rs.filter((r) => r.source === k && r.sev === s).length; return `<td class="${n ? 'has' : ''}">${n || '·'}</td>`; }).join('')}<td class="tot">${rs.filter((r) => r.source === k).length}</td></tr>`).join('');
    return `<div class="rsum ${o.compact ? 'compact' : ''}">
      <div class="rsum-h"><b>Risk summary</b><span>${plural(rs.length, 'open Risk')}${m.unowned.length ? ` · <em class="warn-t">${m.unowned.length} without a Risk owner</em>` : ''}</span></div>
      ${rs.length ? `${bar}${sevs}<table class="rmat"><thead><tr><th scope="col"><span class="sr">Risk Source</span></th>${SEVS.map((s) => `<th scope="col">${SEV_LABEL[s]}</th>`).join('')}<th scope="col">All</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">No open Risks.</p>'}
      <p class="rsum-note">Open Risks never block a gate. The BSO weighs them.</p></div>`;
  }

  // The OAG's Recommendations (Full track), or the OG1 verdicts when `verdicts` is given
  function recsList(m, recs, o = {}) {
    const live = o.live && !m.rejected;
    return `<ul class="recs">${recs.map((r) => {
      const R = r.rec ? REC[r.rec] : null, key = `${m.sys.id}:${o.round}:${r.group}`;
      const mayGive = !r.rec && live && m.v.group === r.group && !m.v.isOwner;
      const f = ui.rec[key];
      return `<li class="rec ${r.rec || 'pending'} ${o.flag && r.rec === 'AGAINST' ? 'flag' : ''}">
        <div class="rec-h">${gav(r.group)}<b class="gname">${esc(GROUPS[r.group].name)}</b>${R ? chip(R.tone, R.label) : chip('', 'Waiting', true)}${r.given ? '<span class="muted small">given just now</span>' : ''}</div>
        ${r.rec ? `<p class="rec-c">${esc(r.comment)}</p>${r.conditions ? `<p class="rec-cond"><span class="label">Conditions</span>${esc(r.conditions)}</p>` : ''}` : `<p class="muted small">No Recommendation yet.</p>`}
        ${mayGive && !f ? `<button class="btn" type="button" data-act="rec-open" data-g="${r.group}" data-round="${o.round}">Give ${esc(GROUPS[r.group].name)}’s Recommendation</button>` : ''}
        ${mayGive && f ? recForm(m, key, f, r.group, o.round) : ''}
      </li>`;
    }).join('')}</ul>`;
  }
  function recForm(m, key, f, group, round) {
    const bad = f.tried;
    return `<form class="rform" data-form="rec" onsubmit="return false">
      <div class="seg" role="group" aria-label="Recommendation of ${esc(GROUPS[group].name)}">${Object.entries(REC).map(([k, R]) => `<button type="button" data-act="rec-pick" data-k="${key}" data-v="${k}" aria-pressed="${f.rec === k}">${R.label}</button>`).join('')}</div>
      <label class="field"><span class="label">Comment (always required)</span><textarea rows="2" data-fid="rc-${key}" data-field="rec-comment" data-k="${key}" aria-invalid="${bad && !f.comment.trim()}">${esc(f.comment)}</textarea></label>
      ${f.rec === 'CONDITIONS' ? `<label class="field"><span class="label">Conditions (free text, not followed up)</span><textarea rows="2" data-fid="rcc-${key}" data-field="rec-cond" data-k="${key}">${esc(f.conditions)}</textarea></label>` : ''}
      ${bad && (!f.rec || !f.comment.trim()) ? '<p class="err">Pick a Recommendation and write a comment.</p>' : ''}
      <div class="row-end"><button type="button" class="btn" data-act="rec-cancel" data-k="${key}">Cancel</button><button type="button" class="btn primary" data-act="rec-submit" data-k="${key}" data-g="${group}" data-round="${round}">Give Recommendation</button></div>
    </form>`;
  }

  // OG1 verdicts: shown as the group's, not the person's
  function verdictsBody(m) {
    const vs = m.sys.og1.verdicts, any = vs.some((x) => x.verdict === 'FULL'), pend = vs.filter((x) => !x.verdict).length;
    const result = pend ? (any ? ['warn', 'Full so far. Any Full means Full'] : ['', 'Open until every group has given a verdict']) : any ? ['warn', 'Full track: at least one group gave Full'] : ['done', 'Self track: every group gave Self'];
    return `<ul class="recs">${vs.map((x) => `<li class="rec ${x.verdict || 'pending'}">
      <div class="rec-h">${gav(x.group)}<b class="gname">${esc(GROUPS[x.group].name)}</b>${x.verdict ? chip(x.verdict === 'FULL' ? 'warn' : 'done', x.verdict === 'FULL' ? 'Full' : 'Self') : chip('', 'Waiting', true)}<span class="muted small">${esc(x.remit)}</span></div>
      ${x.verdict ? `<p class="rec-c">${esc(x.comment)}</p>` : '<p class="muted small">No verdict yet.</p>'}</li>`).join('')}</ul>
      <div class="og1-out">${chip(result[0], result[1])}<span class="muted small">Every group with first-round Controls in its remit, plus the base review, answers. A verdict reopens if an owner edits a Control in its remit.</span></div>`;
  }

  // Risk Analysis record
  function analysisBody(m, key) {
    const a = analysisOf(m.sys, key);
    if (!a) {
      const live = m.now.key === key && !m.rejected;
      return `<div class="empty"><p><b>No Risk Analysis recorded yet.</b></p><p class="muted">A Risk Owner, or an Admin who isn’t the System’s owner, records the meeting: date, participants, notes, and the Risks reviewed and raised. It is done only when every open Risk has a Risk owner.</p>
        ${live ? `<button class="btn primary" type="button" data-act="toast" data-v="Prototype: the Risk Analysis form is not designed here">Record Risk Analysis</button>` : ''}</div>`;
    }
    const ids = [...a.reviewed.map((id) => [id, 'Reviewed']), ...a.raised.map((id) => [id, 'Raised'])];
    const rs = ids.map(([id, how]) => ({ r: riskOf(m.sys, id), how })).filter((x) => x.r);
    const missing = rs.filter((x) => x.r.status === 'OPEN' && !x.r.owner).length;
    return `<div class="ra">
      <dl class="kv"><dt>Date</dt><dd>${fmt(a.date)}</dd><dt>Recorded by</dt><dd>${person(a.by)}</dd>
        <dt>Participants</dt><dd><ul class="people">${a.people.map((p) => `<li>${person(p.name)}${p.kind === 'outsider' ? `<span class="tagx">${esc(p.org)}</span>` : '<span class="tagx user">User</span>'}</li>`).join('')}</ul></dd>
        <dt>Notes</dt><dd>${esc(a.notes)}</dd></dl>
      <div class="tscroll"><table class="rt"><thead><tr><th>Risk</th><th>Severity</th><th class="hide-sm">Risk Source</th><th>In this meeting</th><th>Risk owner</th></tr></thead><tbody>
        ${rs.map(({ r, how }) => `<tr><td><b>${esc(r.title)}</b></td><td>${chip(r.sev === 'CRITICAL' ? 'danger' : r.sev === 'HIGH' ? 'warn' : '', SEV_LABEL[r.sev], true)}</td><td class="hide-sm">${SOURCE_SHORT[r.source]}</td><td>${how}</td><td>${person(r.owner)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No Risks were reviewed or raised.</td></tr>'}
      </tbody></table></div>
      <div class="ra-done ${missing ? 'warn' : 'ok'}">${missing ? `Not done: ${plural(missing, 'open Risk')} without a Risk owner.` : '✓ Done: every open Risk has a Risk owner.'}</div></div>`;
  }

  // Documentation for a stage
  function docsBody(m, key) {
    const ds = stageDocs(m.sys, key);
    if (!ds.length) return '<p class="muted small">No Document Requirements apply at this stage.</p>';
    return `<ul class="docs">${ds.map((d) => `<li class="${d.provided ? 'ok' : 'miss'}"><span class="dk" aria-hidden="true">${d.provided ? '✓' : ''}</span><div><b>${esc(d.name)}</b>${d.provided ? `<small>${esc(d.link)} · provided by ${esc(d.by)}, ${fmt(d.on)}</small>` : '<small>Not provided yet. The stage can’t be submitted without it.</small>'}</div>${d.provided ? chip('success', 'Provided', true) : chip('warn', 'Missing', true)}</li>`).join('')}</ul>`;
  }
  function roundBody(m, key) {
    const r = key === 'r1' ? m.sys.firstRound : m.sys.secondRound, pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
    const docs = key === 'r2' ? stageDocs(m.sys, 'r2') : [];
    return `<div class="prog2"><div class="prog2-h"><b>${r.done} of ${r.total} Controls have an Assessment</b><span class="muted">${pct}%</span></div><div class="pbar"><i style="width:${pct}%"></i></div>
      <p class="muted small">${key === 'r1' ? 'The first round holds the Controls the Framework Owners marked. Every mandatory one needs an Assessment before OG1.' : 'Every mandatory Control needs an Assessment before the second round ends.'} Assessment Queries stay open on both Tracks.</p></div>
      ${docs.length ? `<h4 class="sub">Second-round documentation</h4>${docsBody(m, 'r2')}` : ''}`;
  }

  // Decision history. A decision against an Advise-against shows the justification beside the advice.
  function decisionRecord(d, m) {
    const O = (OUTCOME[d.gate] || {})[d.outcome] || [d.outcome, ''];
    const back = d.outcome === 'BACK' ? ` to ${ST[d.backTo].long.toLowerCase()}${d.backTo === 'r1' ? ' (OG1 runs again)' : ''}` : '';
    return `<li class="dec ${d.against ? 'against' : ''}">
      <div class="dec-h"><b>${esc(GATE_TITLE[d.gate].split(':')[0])}</b>${chip(O[1], O[0] + back)}${d.against ? '<span class="chip danger plain">Against advice</span>' : ''}</div>
      <p class="dec-by muted small">${d.by ? `${esc(d.by)} (BSO)` : 'The groups'} · ${fmt(d.on)}</p>
      <p class="dec-c">${esc(d.comment)}</p>
      ${(d.against || []).map((a) => `<div class="pair"><div class="pair-l"><span class="label">${esc(GROUPS[a.group].name)} advised against</span><p>${esc(a.rec)}</p></div><div class="pair-r"><span class="label">BSO’s justification</span><p>${esc(a.justification)}</p></div></div>`).join('')}
    </li>`;
  }
  const decisionsOf = (sys, gate) => sys.decisions.filter((d) => !gate || d.gate === gate).slice().sort((a, b) => (a.on < b.on ? 1 : -1));
  function historyBody(m, gate) {
    const ds = decisionsOf(m.sys, gate);
    return ds.length ? `<ul class="decs">${ds.map((d) => decisionRecord(d, m)).join('')}</ul>` : '<p class="muted small">No gate decided yet.</p>';
  }

  // The BSO's decision panel
  function decisionPanel(m, gate, o = {}) {
    const { sys, v } = m, done = ui.done[sys.id], live = m.now.key === gate && !m.rejected;
    const recs = recsFor(sys, gate), round = ROUND_OF[gate], against = recs.filter((r) => r.rec === 'AGAINST');
    const d = ui.dec[sys.id] || (ui.dec[sys.id] = { choice: null, comment: '', just: '', back: 'r1', tried: false });
    const needsJust = d.choice === 'GO' && against.length > 0;
    let who = '';
    if (!live) who = '';
    else if (v.isOwner) who = `<div class="callout">You own this System. Nobody decides a gate on a System they own, so you see the panel but can’t decide.</div>`;
    else if (!m.can) who = `<div class="callout">${esc(sys.bso)} (BSO) decides this gate. ${v.label} sees the stages and the Recommendations but can’t decide.</div>`;
    else if (v.admin) who = `<div class="callout warn">You are acting as an Admin for the BSO, ${esc(sys.bso)}. The decision is recorded under your name.</div>`;
    const back = m.stages.filter((s) => s.i < m.idx && s.kind !== 'gate' && s.kind !== 'fork');
    const opts = [['GO', GO[gate]], ['REJECT', 'Reject'], ['BACK', 'Send back']];
    const form = m.can && live && !done ? `<form class="dform" onsubmit="return false" aria-label="Your decision">
      <div class="label">Your decision</div>
      <div class="opts" role="radiogroup" aria-label="Decision">${opts.map(([k, l]) => `<button type="button" role="radio" class="opt ${k}" data-act="choose" data-v="${k}" aria-checked="${d.choice === k}" aria-pressed="${d.choice === k}">${l}</button>`).join('')}</div>
      ${d.choice === 'BACK' ? `<label class="field"><span class="label">Send back to</span><select class="sel" data-field="back" data-fid="back-${sys.id}">${back.map((s) => `<option value="${s.key}" ${d.back === s.key ? 'selected' : ''}>${esc(s.long)}${s.key === 'r1' ? ': OG1 runs again' : ''}</option>`).join('')}</select></label>` : ''}
      ${d.choice === 'REJECT' ? '<div class="callout warn">Reject is final. The System is closed and read-only.</div>' : ''}
      ${needsJust ? `<div class="against-box"><p><b>You are deciding against ${against.length > 1 ? 'Advise-against Recommendations' : 'an Advise-against Recommendation'}.</b> A written justification is required and is shown next to the advice.</p>
        ${against.map((r) => `<div class="pair"><div class="pair-l"><span class="label">${esc(GROUPS[r.group].name)} advises against</span><p>${esc(r.comment)}</p></div>${against.indexOf(r) === 0 ? `<div class="pair-r"><label class="field"><span class="label">Your justification (required)</span><textarea rows="4" data-fid="just-${sys.id}" data-field="just" aria-invalid="${d.tried && !d.just.trim()}">${esc(d.just)}</textarea></label>${d.tried && !d.just.trim() ? '<p class="err">Write why you are deciding against the advice.</p>' : ''}</div>` : '<div class="pair-r muted small">Covered by the justification beside the first Recommendation.</div>'}</div>`).join('')}</div>` : ''}
      <label class="field"><span class="label">Comment (always required)</span><textarea rows="3" data-fid="comment-${sys.id}" data-field="comment" aria-invalid="${d.tried && !d.comment.trim()}" placeholder="Why this decision">${esc(d.comment)}</textarea>${d.tried && !d.comment.trim() ? '<p class="err">Write a comment.</p>' : ''}</label>
      <div class="row-end"><button type="button" class="btn primary" data-act="decide" ${d.choice ? '' : 'aria-disabled="true"'}>${d.choice ? `Record: ${opts.find((x) => x[0] === d.choice)[1]}` : 'Pick a decision'}</button></div>
    </form>` : '';
    const recorded = done ? `<div class="callout ok"><b>Recorded in this prototype:</b> ${esc(opts.find((x) => x[0] === done.choice)[1])}${done.choice === 'BACK' ? ' to ' + esc(ST[done.back].long) : ''}${done.against ? ', against advice, with your justification shown beside it' : ''}. Nothing is saved.<br><button class="link" type="button" data-act="undo">Undo and decide again</button></div>` : '';
    const body = [];
    if (gate === 'qual' || gate === 'og1') body.push(`<h4 class="sub">OG1 verdicts</h4>${verdictsBody(m)}`);
    if (gate === 'og2' || gate === 'og3') body.push(sys.track === 'FULL' ? `<h4 class="sub">Recommendations</h4>${recsList(m, recs, { round, flag: needsJust })}` : '<p class="muted small">The Self track has no Recommendations.</p>');
    body.push(riskSummary(m, { compact: o.compact }));
    return `<section class="dpanel ${o.cls || ''}" aria-label="Decision at ${esc(GATE_TITLE[gate])}">
      <div class="dp-h"><div><span class="eyebrow">${live ? 'Waiting for the BSO' : 'Decision'}</span><h3>${esc(GATE_TITLE[gate])}</h3></div>${live ? chip('warn', 'Open', true) : ''}</div>
      <p class="muted small">${sys.track === 'FULL' ? 'The Onboarding Advisory Group recommends. The Business System Owner decides.' : gate === 'og3' ? 'The Business System Owner decides whether the System may operate.' : 'The Business System Owner decides.'}</p>
      ${who}${body.join('')}${recorded}${form}</section>`;
  }

  // ---------- one stage, in full ----------
  function stageBody(m, key) {
    const s = m.stages.find((x) => x.key === key), sys = m.sys;
    switch (s.kind) {
      case 'round': return roundBody(m, key);
      case 'ra': return analysisBody(m, key);
      case 'doc': return docsBody(m, key);
      case 'oag': return recsList(m, recsOf(sys, key), { round: key, live: m.now.key === key }) + `<p class="muted small">${m.now.key === key ? 'The stage moves to the gate once every group has recommended. A Recommendation reopens if an owner edits a Control in the group’s remit.' : ''}</p>`;
      case 'fork': return `<p>The Track is not chosen yet. OG1 chooses it when every group has given its verdict.</p><div class="muted small" style="margin-top:6px">Self: second round, Risk Analysis, then OG3. Full: Qualification, first documentation, OAG review, OG2, second round, Risk Analysis, OAG review, then OG3.</div>`;
      case 'end': return '<p>OG3 authorized the System to operate. The System’s owner or an Admin marks it Onboarded when the cutover has happened.</p>';
      case 'gate': {
        if (key === 'og1') return verdictsBody(m) + (decisionsOf(sys, 'og1').length ? `<h4 class="sub">Outcome</h4>${historyBody(m, 'og1')}` : '');
        if (m.now.key === key) return decisionPanel(m, key, { cls: 'inline' }) + (decisionsOf(sys, key).length ? `<h4 class="sub">Earlier decisions at this gate</h4>${historyBody(m, key)}` : '');
        const ds = decisionsOf(sys, key);
        if (s.state === 'done' || ds.length) {
          const recs = recsFor(sys, key), round = ROUND_OF[key];
          return historyBody(m, key) + (recs.length ? `<h4 class="sub">Recommendations at the time</h4>${recsList(m, recs, { round })}` : '');
        }
        return `<p class="muted">Not reached yet. ${esc(sys.bso)} (BSO) decides it${ROUND_OF[key] && sys.track === 'FULL' ? ' after the Recommendations' : ''}.</p>`;
      }
    }
    return '';
  }
  // A one-line outcome per stage, for collapsed blocks and tooltips
  function summaryOf(m, s) {
    const sys = m.sys;
    if (s.state === 'todo') return 'Later';
    if (s.kind === 'round') { const r = s.key === 'r1' ? sys.firstRound : sys.secondRound; return `${r.done} of ${r.total} Controls assessed`; }
    if (s.kind === 'ra') { const a = analysisOf(sys, s.key); return a ? `Recorded ${fmt(a.date)}, ${plural(a.people.length, 'participant')}` : 'Not recorded'; }
    if (s.kind === 'doc') { const d = stageDocs(sys, s.key); return `${d.filter((x) => x.provided).length} of ${d.length} documents provided`; }
    if (s.kind === 'oag') { const r = recsOf(sys, s.key); return `${r.filter((x) => x.rec).length} of ${r.length} Recommendations in`; }
    if (s.kind === 'gate') {
      const last = decisionsOf(sys, s.key)[0];
      if (!last) return s.state === 'now' ? 'Waiting' : 'Not decided';
      return `${(OUTCOME[s.key][last.outcome] || [last.outcome])[0]}, ${fmt(last.on)}${last.against ? ', against advice' : ''}`;
    }
    return '';
  }

  // ---------- the page shell ----------
  function hero(m, extra) {
    const { sys, v } = m, n = m.counted.length, done = m.counted.filter((s) => s.state === 'done').length;
    const segs = [[done / n, m.rejected ? 'var(--bad)' : 'var(--accent)']];
    const L = m.left;
    return `<section class="hero" aria-label="${esc(sys.name)}">
      <div>
        <div class="crumb"><a href="/design/systems/proposal-a.html${g.Appbar ? '#role=' + g.Appbar.roleKey() : ''}">Systems</a> / ${esc(sys.name)}</div>
        <div class="who-row"><div class="mark" aria-hidden="true">${sys.mark}</div><div><h1>${esc(sys.name)}</h1><p class="lede">${esc(sys.desc)}</p></div></div>
        <div class="chips">${chip(m.rejected ? 'danger' : 'warn', m.rejected ? 'Rejected' : m.now.kind === 'end' ? 'Authorized' : 'In evaluation')}${trackChip(sys)}${stageChip(m)}
          <span class="meta-i">Owner ${person(sys.owner)}</span><span class="meta-i">BSO ${person(sys.bso)}</span><span class="meta-i muted">${esc(sys.vendor)} · ${sys.facets.map(esc).join(' + ')} · ${esc(sys.impact)} impact</span></div>
      </div>
      <div class="move" aria-label="Evaluation progress">${Kit.ring(segs, 84, 9, `${done}/${n}`, sys.track ? 'stages' : 'to OG1')}
        <ul class="mv"><li><span>Track</span><b>${sys.track === 'SELF' ? 'Self' : sys.track === 'FULL' ? 'Full' : 'Not chosen'}</b></li><li><span>Now</span><b>${esc(m.now.label)}</b></li><li><span>Next</span><b>${L.next ? esc(L.next.label) : 'None'}</b></li><li><span>Waiting</span><b>${esc((L.waiting || 'Nobody').split(',')[0])}${L.waiting.includes(',') ? ' +' : ''}</b></li></ul></div>
      ${extra ? `<div class="hero-extra">${extra}</div>` : ''}
    </section>`;
  }

  function stat(tab, k, val, tone, sub) {
    return `<button class="card stat ${tone || ''}" type="button" data-act="tab" data-v="${tab}"><span class="k">${k}<em>Open →</em></span><span class="v">${val}</span>${sub ? `<span class="muted small">${sub}</span>` : ''}</button>`;
  }
  function stats(m) {
    const { sys } = m, last = sys.track === 'FULL' ? (m.now.key === 'og2' || ['qual', 'doc1', 'oag1'].includes(m.now.key) ? 'oag1' : 'oag2') : null;
    const rs = last ? recsOf(sys, last) : [], got = rs.filter((r) => r.rec).length;
    const ds = sys.docs.filter((d) => d.tracks.includes(sys.track || 'FULL')), dp = ds.filter((d) => d.provided).length;
    return `<div class="stats">
      ${stat('evaluation', 'Stage', esc(m.now.label), m.rejected ? 'danger' : 'warn', sys.track ? esc(trackName(sys)) : 'Track not chosen')}
      ${rs.length ? stat('evaluation', 'Recommendations', `${got}/${rs.length}`, got === rs.length ? 'ok' : '', rs.some((r) => r.rec === 'AGAINST') ? `${rs.filter((r) => r.rec === 'AGAINST').length} Advise against` : '') : stat('evaluation', 'Verdicts at OG1', `${sys.og1.verdicts.filter((x) => x.verdict).length}/${sys.og1.verdicts.length}`, '', sys.track === 'SELF' ? 'No Recommendations on Self' : '')}
      ${stat('risks', 'Open Risks', m.openRisks.length, m.unowned.length ? 'danger' : '', m.unowned.length ? `${m.unowned.length} without a Risk owner` : 'Every one has a Risk owner')}
      ${stat('evaluation', 'Documents', `${dp}/${ds.length}`, dp < ds.length ? 'warn' : 'ok', 'Document Requirements provided')}
    </div>`;
  }
  const trackName = (sys) => (sys.track === 'SELF' ? 'Self track' : 'Full track');

  function overview(m, tracker) {
    const L = m.left;
    return `<div class="ovgrid">
      <article class="card spot"><div class="card-h"><h2>Evaluation</h2><button class="link" type="button" data-act="tab" data-v="evaluation">Open the Evaluation tab →</button></div><div class="card-b">${tracker(m)}</div></article>
      <article class="card spot"><div class="card-h"><h2>What is left</h2><p>${esc(m.now.long)}</p></div><div class="card-b"><ul class="left">${L.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><p class="muted small" style="margin-top:8px">${L.waiting ? `Waiting for ${esc(L.waiting)}.` : ''}${L.next ? ` Next: ${esc(L.next.long)}.` : ''}</p></div></article>
      <article class="card spot"><div class="card-b">${riskSummary(m)}</div></article>
      <article class="card spot"><div class="card-h"><h2>Recent decisions</h2><p>${plural(m.sys.decisions.length, 'gate decision')}</p></div><div class="card-b">${historyBody(m)}</div></article>
    </div>`;
  }

  function stub(m, tab) {
    const name = { controls: 'Controls', risks: 'Risks', activity: 'Activity' }[tab];
    const body = tab === 'risks' ? `<div class="card-b">${riskSummary(m)}<p class="muted small" style="margin-top:10px">The Risk register itself is unchanged from the Cockpit. A Risk shows its Risk Source and Risk owner there.</p></div>`
      : tab === 'activity' ? `<div class="card-b">${historyBody(m)}<p class="muted small" style="margin-top:10px">The Activity feed would also list each move between stages as a Change Event.</p></div>`
        : `<div class="card-b"><p>${m.sys.controls} Controls, ${m.sys.firstRound.total} of them in the first round.</p><p class="muted small" style="margin-top:6px">Unchanged from the Cockpit (<a href="../system/proposal-a.html">System proposal A</a>). This prototype designs the evaluation only.</p></div>`;
    return `<article class="card"><div class="card-h"><h2>${name}</h2><p>Not part of this proposal</p></div>${body}</article>`;
  }

  // The whole page. A proposal passes: heroExtra (HTML), tracker(m) (Overview tile) and evaluation(m) (the Evaluation tab).
  function page(m, p) {
    const counts = { evaluation: m.rejected ? '' : String(m.left.items.length), controls: m.sys.controls, risks: m.openRisks.length, activity: m.sys.decisions.length };
    const tabs = TABS.map((k) => `<button type="button" role="tab" id="tab-${k}" aria-selected="${ui.tab === k}" data-act="tab" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}${counts[k] !== undefined && counts[k] !== '' ? `<span class="n ${k === 'evaluation' && m.can ? 'hot' : ''}">${counts[k]}</span>` : ''}</button>`).join('');
    const panel = ui.tab === 'overview' ? `${stats(m)}${overview(m, p.tracker)}` : ui.tab === 'evaluation' ? p.evaluation(m) : stub(m, ui.tab);
    return `${hero(m, p.heroExtra)}<div class="card tabbar"><div class="tabs" role="tablist" aria-label="System sections">${tabs}</div></div>
      <div class="panel" role="tabpanel" aria-labelledby="tab-${ui.tab}">${panel}</div>`;
  }

  // The proposal-only bar above the page: which example System, and who is acting
  function proto(m) {
    const v = m.v, quick = [['SYSTEM_OWNER', 'Marcus Lindqvist'], ['REVIEWER', 'Sara Ek'], ['BUSINESS_RISK_OWNER', 'Lena Holm'], ['ADMIN', 'Default Admin']];
    const as = v.isOwner ? 'the System’s owner' : v.isBSO ? 'the BSO of this System' : v.admin ? 'an Admin' : v.group ? 'a member of the Base review' : 'neither owner nor BSO';
    return `<div class="proto"><label>Example System <select class="sel" data-act="system" aria-label="Example System">${D.systems.map((s) => `<option value="${s.id}" ${s.id === ui.id ? 'selected' : ''}>${esc(s.name)}: ${s.outcome === 'REJECTED' ? 'rejected' : s.track ? s.track === 'SELF' ? 'Self' : 'Full' : 'Track not chosen'}, ${esc(ST[s.stage].label)}</option>`).join('')}</select></label>
      <span class="proto-note">Acting as <b>${esc(v.name)}</b>, ${as}. ${esc(m.sys.bso)} is the BSO of every example System; the BSO is an assignment, not a role.</span>
      <span class="fl">Act as ${quick.map(([k, n]) => `<button type="button" class="pill" data-act="role" data-v="${k}" aria-pressed="${v.key === k}">${n}</button>`).join('')}</span>
      <span class="proto-hint">A prototype: buttons change this page only. Nothing is saved.</span></div>`;
  }

  // ---------- events ----------
  function refresh() {
    if (!renderer) return;
    const a = doc.activeElement, fid = a && a.dataset ? a.dataset.fid : null, pos = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    const y = scrollY, m = model();
    doc.getElementById('proto').innerHTML = proto(m);
    renderer.render(rootEl, m);
    if (renderer.afterRender) renderer.afterRender(rootEl, m);
    doc.title = `${m.sys.name}: staged evaluation`;
    if (fid) { const n = doc.querySelector(`[data-fid="${fid}"]`); if (n) { n.focus({ preventScroll: true }); if (pos && n.setSelectionRange) try { n.setSelectionRange(...pos); } catch (e) { /* not a text field */ } } }
    scrollTo(0, y);
  }
  function setQuery() {
    const u = new URL(location.href); u.searchParams.set('system', ui.id); u.searchParams.set('tab', ui.tab);
    history.replaceState(null, '', u.pathname + u.search + location.hash);
  }
  function pick(id) { ui.id = id; ui.drawer = null; setQuery(); refresh(); }
  function setTab(t) { ui.tab = t; setQuery(); refresh(); }
  const draft = () => ui.dec[ui.id] || (ui.dec[ui.id] = { choice: null, comment: '', just: '', back: 'r1', tried: false });

  doc.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return;
    const a = el.dataset.act, v = el.dataset.v, sys = sysOf();
    if (a === 'tab') { e.preventDefault(); setTab(v); }
    else if (a === 'role') { g.Appbar.setRole(v); }
    else if (a === 'choose') { const d = draft(); d.choice = v; d.tried = false; refresh(); }
    else if (a === 'decide') {
      const m = model(), d = draft(), against = recsFor(sys, m.now.key).some((r) => r.rec === 'AGAINST') && d.choice === 'GO';
      if (!d.choice) { return; }
      if (!d.comment.trim() || (against && !d.just.trim())) { d.tried = true; refresh(); return; }
      ui.done[sys.id] = { choice: d.choice, back: d.back, against }; Kit.toast('Decision recorded in this prototype. Nothing is saved.'); refresh();
    }
    else if (a === 'undo') { delete ui.done[sys.id]; ui.dec[sys.id] = null; refresh(); }
    else if (a === 'rec-open') { ui.rec[`${sys.id}:${el.dataset.round}:${el.dataset.g}`] = { rec: null, comment: '', conditions: '', tried: false }; refresh(); }
    else if (a === 'rec-cancel') { delete ui.rec[el.dataset.k]; refresh(); }
    else if (a === 'rec-pick') { ui.rec[el.dataset.k].rec = v; refresh(); }
    else if (a === 'rec-submit') {
      const f = ui.rec[el.dataset.k];
      if (!f.rec || !f.comment.trim()) { f.tried = true; refresh(); return; }
      ui.given[el.dataset.k] = { rec: f.rec, comment: f.comment.trim(), conditions: f.rec === 'CONDITIONS' ? f.conditions.trim() : '' }; delete ui.rec[el.dataset.k]; Kit.toast('Recommendation given in this prototype.'); refresh();
    }
    else if (a === 'toast') { Kit.toast(v); }
    else if (a === 'stage') { ui.sel[sys.id] = v; ui.tab = 'evaluation'; setQuery(); refresh(); }
    else if (a === 'toggle') { ui.open[sys.id + ':' + v] = !(ui.open[sys.id + ':' + v] ?? el.getAttribute('aria-expanded') === 'true'); refresh(); }
    else if (a === 'gate') { ui.drawer = v; ui.tab = 'evaluation'; refresh(); const c = doc.querySelector('[data-drawer-close]'); if (c) c.focus(); }
    else if (a === 'close') { ui.drawer = null; refresh(); }
  });
  doc.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.act === 'system') pick(e.target.value); });
  doc.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.field; if (!f) return;
    const d = draft();
    if (f === 'comment') d.comment = e.target.value; else if (f === 'just') d.just = e.target.value; else if (f === 'back') { d.back = e.target.value; }
    else if (f === 'rec-comment') ui.rec[e.target.dataset.k].comment = e.target.value; else if (f === 'rec-cond') ui.rec[e.target.dataset.k].conditions = e.target.value;
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.drawer) { ui.drawer = null; refresh(); } });

  function mount(r) {
    renderer = r; rootEl = doc.getElementById('page');
    addEventListener('appbar:role', refresh);
    refresh();
  }
  const paletteItems = () => D.systems.map((s) => ({ group: 'Example Systems', label: s.name, sub: `${s.track ? (s.track === 'SELF' ? 'Self' : 'Full') + ' track' : 'Track not chosen'}, ${ST[s.stage].label}`, icon: 'system', run: () => pick(s.id) }));

  g.EV = { D, ui, esc, plural, initials, fmt, chip, person, gav, trackChip, stageChip, tracksStrip, riskSummary, recsList, recsOf, verdictsBody, analysisBody, docsBody, roundBody, historyBody,
    decisionRecord, decisionPanel, stageBody, summaryOf, model, page, mount, refresh, paletteItems, ST, TRACKS, GROUPS, GATE_TITLE, OUTCOME, REC, decisionsOf, nodeIcon, stageDocs, analysisOf };
})(window);
