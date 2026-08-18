/* Slayers Squad API — Express + Postgres (Neon)
 * Endpoints:
 *   GET    /api/team/:id                     -> { team, bowlers, sessions }   (public read)
 *   POST   /api/team/:id/bowler              -> add bowler        (needs x-post-code)
 *   DELETE /api/team/:id/bowler/:bid         -> remove bowler     (needs x-post-code)
 *   POST   /api/team/:id/session             -> add a series      (needs x-post-code)
 *   DELETE /api/team/:id/session/:sid        -> remove a series   (needs x-post-code)
 *   PATCH  /api/team/:id                     -> update settings   (needs x-post-code)
 */
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- CORS (set CORS_ORIGIN to your GitHub Pages origin, or leave * while testing) ---
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-post-code, x-sync-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- write auth: shared per-team post code in header ---
async function requireCode(req, res, next) {
  try {
    const code = req.header('x-post-code') || '';
    const { rows } = await pool.query('select post_code from teams where id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'team not found' });
    if (code !== rows[0].post_code) return res.status(401).json({ error: 'bad post code' });
    next();
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}

const clampArr = (a, lo, hi, max) =>
  Array.isArray(a) ? a.map(n => Math.max(lo, Math.min(hi, parseInt(n) || 0))).slice(0, max) : null;

// --- read snapshot (public) ---
app.get('/api/team/:id', async (req, res) => {
  try {
    const t = await pool.query(
      'select id,name,handicap_basis,handicap_pct from teams where id=$1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'team not found' });
    const b = await pool.query(
      'select id,name,hand,created_at from bowlers where team_id=$1 order by created_at', [req.params.id]);
    const s = await pool.query(
      'select id,bowler_id,to_char(date,\'YYYY-MM-DD\') as date,house,games,strikes,spares,frames,created_at ' +
      'from sessions where team_id=$1 order by date desc, created_at desc', [req.params.id]);
    const m = await pool.query(
      "select m.id, to_char(m.date,'YYYY-MM-DD') as date, m.house, m.opponent_name, m.opp_bowlers, " +
      "coalesce(json_agg(json_build_object('slot',mu.slot,'our_bowlers',mu.our_bowlers,'our_score',mu.our_score,'opp_score',mu.opp_score) " +
      "order by mu.slot) filter (where mu.id is not null),'[]') as matchups " +
      "from matches m left join matchups mu on mu.match_id=m.id where m.team_id=$1 " +
      "group by m.id order by m.date desc, m.created_at desc", [req.params.id]);
    res.json({ team: t.rows[0], bowlers: b.rows, sessions: s.rows, matches: m.rows });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- add bowler ---
app.post('/api/team/:id/bowler', requireCode, async (req, res) => {
  try {
    const name = (req.body.name || '').toString().slice(0, 40).trim();
    const hand = req.body.hand === 'L' ? 'L' : 'R';
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(
      'insert into bowlers(team_id,name,hand) values($1,$2,$3) returning id,name,hand,created_at',
      [req.params.id, name, hand]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- remove bowler (cascades their sessions) ---
app.delete('/api/team/:id/bowler/:bid', requireCode, async (req, res) => {
  try {
    await pool.query('delete from bowlers where id=$1 and team_id=$2', [req.params.bid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- add a series (up to 3 games + optional strikes/spares per game) ---
app.post('/api/team/:id/session', requireCode, async (req, res) => {
  try {
    const bowler_id = req.body.bowler_id;
    const games = clampArr(req.body.games, 0, 300, 3);
    if (!bowler_id || !games || !games.length) return res.status(400).json({ error: 'bowler_id and games required' });
    const strikes = clampArr(req.body.strikes, 0, 12, 3);
    const spares = clampArr(req.body.spares, 0, 10, 3);
    const date = (req.body.date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10);
    const frames = Array.isArray(req.body.frames) ? JSON.stringify(req.body.frames) : null;
    const house = (req.body.house || '').toString().slice(0, 60).trim() || null;
    const r = await pool.query(
      'insert into sessions(team_id,bowler_id,date,house,games,strikes,spares,frames) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ' +
      'returning id,bowler_id,to_char(date,\'YYYY-MM-DD\') as date,house,games,strikes,spares,frames,created_at',
      [req.params.id, bowler_id, date, house, games, strikes, spares, frames]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- remove a series ---
app.delete('/api/team/:id/session/:sid', requireCode, async (req, res) => {
  try {
    await pool.query('delete from sessions where id=$1 and team_id=$2', [req.params.sid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- update team settings (name / handicap) ---
app.patch('/api/team/:id', requireCode, async (req, res) => {
  try {
    const name = req.body.name != null ? String(req.body.name).slice(0, 30) : null;
    const basis = req.body.handicap_basis != null ? parseInt(req.body.handicap_basis) : null;
    const pct = req.body.handicap_pct != null ? parseInt(req.body.handicap_pct) : null;
    const r = await pool.query(
      'update teams set name=coalesce($2,name), handicap_basis=coalesce($3,handicap_basis), ' +
      'handicap_pct=coalesce($4,handicap_pct) where id=$1 returning id,name,handicap_basis,handicap_pct',
      [req.params.id, name, basis, pct]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- rename or merge a house/center across all this team's sessions ---
app.patch('/api/team/:id/house', requireCode, async (req, res) => {
  try {
    const from = (req.body.from || '').toString().slice(0, 60).trim();
    const to = (req.body.to || '').toString().slice(0, 60).trim() || null;
    if (!from) return res.status(400).json({ error: 'from required' });
    const r = await pool.query(
      'update sessions set house=$3 where team_id=$1 and house=$2', [req.params.id, from, to]);
    res.json({ ok: true, moved: r.rowCount });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- log a tour stop (match + its matchups); upserts the opponent by name ---
/* ---- availability RSVPs (who's in for each tour stop) ---- */
app.get('/api/team/:id/avail', async (req, res) => {
  try {
    const r = await pool.query(
      "select event_key, name, status, to_char(updated_at,'YYYY-MM-DD') as updated " +
      'from team_avail where team_id=$1 order by updated_at', [req.params.id]);
    res.json({ avail: r.rows });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/team/:id/avail', requireCode, async (req, res) => {
  try {
    const { event_key, name, status } = req.body || {};
    const nm = String(name || '').trim().slice(0, 40);
    if (!event_key || !nm) return res.status(400).json({ error: 'event_key and name required' });
    if (status === 'clear') {
      await pool.query('delete from team_avail where team_id=$1 and event_key=$2 and lower(name)=lower($3)',
        [req.params.id, event_key, nm]);
      return res.json({ ok: true, cleared: true });
    }
    if (status !== 'yes' && status !== 'no') return res.status(400).json({ error: 'status must be yes, no, or clear' });
    await pool.query(
      'insert into team_avail (team_id, event_key, name, status) values ($1,$2,$3,$4) ' +
      'on conflict (team_id, event_key, lower(name)) do update set status=excluded.status, name=excluded.name, updated_at=now()',
      [req.params.id, event_key, nm, status]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/team/:id/match', requireCode, async (req, res) => {
  const client = await pool.connect();
  try {
    const teamId = req.params.id;
    const date = (req.body.date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10);
    const house = req.body.house ? String(req.body.house).slice(0, 60).trim() : null;
    const oppName = req.body.opponent ? String(req.body.opponent).slice(0, 60).trim() : null;
    const oppBowlers = Array.isArray(req.body.opp_bowlers) ? JSON.stringify(req.body.opp_bowlers.slice(0, 12)) : null;
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    await client.query('begin');
    let oppId = null;
    if (oppName) {
      const ex = await client.query('select id from opponents where team_id=$1 and lower(name)=lower($2)', [teamId, oppName]);
      oppId = ex.rows.length ? ex.rows[0].id
        : (await client.query('insert into opponents(team_id,name) values($1,$2) returning id', [teamId, oppName])).rows[0].id;
    }
    const mr = await client.query(
      'insert into matches(team_id,date,house,opponent_id,opponent_name,opp_bowlers) values($1,$2,$3,$4,$5,$6::jsonb) returning id',
      [teamId, date, house, oppId, oppName, oppBowlers]);
    const matchId = mr.rows[0].id;
    for (const s of slots) {
      const slot = ['scratch', 'hcp1', 'hcp2'].includes(s.slot) ? s.slot : 'scratch';
      const who = Array.isArray(s.our_bowlers) ? s.our_bowlers.filter(Boolean).slice(0, 3) : [];
      const our = s.our_score != null && s.our_score !== '' ? parseInt(s.our_score) : null;
      const opp = s.opp_score != null && s.opp_score !== '' ? parseInt(s.opp_score) : null;
      await client.query(
        'insert into matchups(match_id,slot,our_bowlers,our_score,opp_score) values($1,$2,$3,$4,$5)',
        [matchId, slot, who.length ? who : null, our, opp]);
    }
    await client.query('commit');
    res.json({ ok: true, id: matchId });
  } catch (e) { await client.query('rollback').catch(() => {}); res.status(500).json({ error: String(e.message || e) }); }
  finally { client.release(); }
});

// --- delete a logged stop ---
app.delete('/api/team/:id/match/:mid', requireCode, async (req, res) => {
  try {
    await pool.query('delete from matches where id=$1 and team_id=$2', [req.params.mid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

/* ===== Cloud backup & sync (opt-in) =====
 * Auth model: a random sync key IS the account — no emails, no passwords stored.
 *   POST   /api/sync/register        {name}   -> { key, name }
 *   GET    /api/sync/games           (x-sync-key) -> { name, games:[...] }
 *   POST   /api/sync/games           (x-sync-key) {games:[...]} -> replace-all for that user
 *   DELETE /api/sync/account         (x-sync-key) -> wipe the user + all their games
 */
function makeSyncKey() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I lookalikes
  const buf = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) { out += alpha[buf[i] % alpha.length]; if (i % 4 === 3 && i < 11) out += '-'; }
  return 'RR-' + out;
}
async function requireSync(req, res, next) {
  try {
    const key = req.header('x-sync-key') || '';
    if (!key) return res.status(401).json({ error: 'missing sync key' });
    const { rows } = await pool.query('select id, name from app_users where sync_key=$1', [key]);
    if (!rows.length) return res.status(401).json({ error: 'bad sync key' });
    req.syncUser = rows[0];
    next();
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}

app.post('/api/sync/register', async (req, res) => {
  try {
    const name = (req.body.name || '').toString().slice(0, 40).trim();
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = makeSyncKey();
      try {
        await pool.query('insert into app_users(name, sync_key) values($1,$2)', [name, key]);
        return res.json({ key: key, name: name });
      } catch (e) { if (!/unique/i.test(String(e))) throw e; } // rare collision: retry
    }
    res.status(500).json({ error: 'could not mint a key, try again' });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/sync/games', requireSync, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "select cid, to_char(d,'YYYY-MM-DD') as d, house, ball, score, frames, adj, imported " +
      'from user_games where user_id=$1 order by d, created_at', [req.syncUser.id]);
    res.json({ name: req.syncUser.name, games: rows });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/sync/games', requireSync, async (req, res) => {
  const client = await pool.connect();
  try {
    const games = Array.isArray(req.body.games) ? req.body.games.slice(0, 2000) : null;
    if (!games) return res.status(400).json({ error: 'games array required' });
    await client.query('begin');
    await client.query('delete from user_games where user_id=$1', [req.syncUser.id]);
    for (const g of games) {
      const cid = (g.cid || '').toString().slice(0, 40);
      if (!cid) continue;
      const d = (g.d || '').toString().slice(0, 10) || null;
      const house = g.house ? String(g.house).slice(0, 60) : null;
      const ball = g.ball ? String(g.ball).slice(0, 60) : null;
      const score = (g.score != null) ? Math.max(0, Math.min(300, parseInt(g.score) || 0)) : null;
      const frames = Array.isArray(g.frames) ? JSON.stringify(g.frames.slice(0, 12)) : null;
      const adj = Array.isArray(g.adj) ? JSON.stringify(g.adj.slice(0, 40)) : null;
      await client.query(
        'insert into user_games(user_id,cid,d,house,ball,score,frames,adj,imported) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ' +
        'on conflict (user_id,cid) do nothing',
        [req.syncUser.id, cid, d, house, ball, score, frames, adj, !!g.imported]);
    }
    await client.query('commit');
    res.json({ ok: true, saved: games.length });
  } catch (e) { await client.query('rollback').catch(() => {}); res.status(500).json({ error: String(e.message || e) }); }
  finally { client.release(); }
});

app.delete('/api/sync/account', requireSync, async (req, res) => {
  try {
    await pool.query('delete from app_users where id=$1', [req.syncUser.id]); // cascades user_games
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/', (_req, res) => res.type('text').send('Slayers Squad API is up.'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Slayers Squad API listening on ' + port));
