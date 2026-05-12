const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── TRAINERS ────────────────────────────────────────────────────────────────

app.get('/api/trainers', (req, res) => {
  try {
    const trainers = db.all(`
      SELECT t.*,
        COUNT(CASE WHEN tc.status = 'active' THEN 1 END) as client_count
      FROM TRAINER t
      LEFT JOIN TRAINER_CLIENT tc ON t.trainer_id = tc.trainer_id
      GROUP BY t.trainer_id
      ORDER BY t.first_name
    `);
    res.json(trainers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trainers/:id', (req, res) => {
  try {
    const trainer = db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [req.params.id]);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });

    const clients = db.all(`
      SELECT c.*, tc.assigned_date, tc.status as assignment_status, tc.id as assignment_id
      FROM CLIENT c
      JOIN TRAINER_CLIENT tc ON c.client_id = tc.client_id
      WHERE tc.trainer_id = ? AND tc.status = 'active'
      ORDER BY c.first_name
    `, [req.params.id]);

    res.json({ ...trainer, clients });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trainers', (req, res) => {
  try {
    const { first_name, last_name, email, phone, specialization, max_clients } = req.body;
    if (!first_name || !last_name || !email)
      return res.status(400).json({ error: 'first_name, last_name, and email are required' });

    const result = db.run(
      'INSERT INTO TRAINER (first_name,last_name,email,phone,specialization,max_clients) VALUES (?,?,?,?,?,?)',
      [first_name, last_name, email, phone || null, specialization || null, max_clients || 10]
    );
    res.status(201).json(db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [result.lastInsertRowid]));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/trainers/:id', (req, res) => {
  try {
    const trainer = db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [req.params.id]);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });

    const { first_name, last_name, email, phone, specialization, max_clients } = req.body;
    db.run(`
      UPDATE TRAINER SET
        first_name = COALESCE(?,first_name),
        last_name = COALESCE(?,last_name),
        email = COALESCE(?,email),
        phone = COALESCE(?,phone),
        specialization = COALESCE(?,specialization),
        max_clients = COALESCE(?,max_clients)
      WHERE trainer_id = ?
    `, [first_name||null, last_name||null, email||null, phone||null, specialization||null, max_clients||null, req.params.id]);

    res.json(db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [req.params.id]));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ─── CLIENTS ─────────────────────────────────────────────────────────────────

app.get('/api/clients', (req, res) => {
  try {
    const clients = db.all(`
      SELECT c.*,
        t.first_name || ' ' || t.last_name as trainer_name,
        tc.id as assignment_id,
        tc.trainer_id,
        m.plan_type, m.end_date as membership_end,
        CASE WHEN m.end_date >= date('now') AND m.start_date <= date('now') THEN 'active' ELSE 'expired' END as membership_status
      FROM CLIENT c
      LEFT JOIN TRAINER_CLIENT tc ON c.client_id = tc.client_id AND tc.status = 'active'
      LEFT JOIN TRAINER t ON tc.trainer_id = t.trainer_id
      LEFT JOIN MEMBERSHIP m ON c.client_id = m.client_id
      ORDER BY c.first_name
    `);
    res.json(clients);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', (req, res) => {
  try {
    const client = db.get(`
      SELECT c.*,
        t.first_name || ' ' || t.last_name as trainer_name,
        t.trainer_id, t.specialization as trainer_specialization,
        tc.id as assignment_id, tc.assigned_date
      FROM CLIENT c
      LEFT JOIN TRAINER_CLIENT tc ON c.client_id = tc.client_id AND tc.status = 'active'
      LEFT JOIN TRAINER t ON tc.trainer_id = t.trainer_id
      WHERE c.client_id = ?
    `, [req.params.id]);

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const sessions = db.all(`
      SELECT s.*, t.first_name || ' ' || t.last_name as trainer_name
      FROM SESSION s
      JOIN TRAINER t ON s.trainer_id = t.trainer_id
      WHERE s.client_id = ?
      ORDER BY s.scheduled_at DESC
      LIMIT 20
    `, [req.params.id]);

    const membership = db.get(`
      SELECT *,
        CASE WHEN end_date >= date('now') AND start_date <= date('now') THEN 'active' ELSE 'expired' END as status
      FROM MEMBERSHIP WHERE client_id = ?
      ORDER BY start_date DESC LIMIT 1
    `, [req.params.id]);

    res.json({ ...client, sessions, membership: membership || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', (req, res) => {
  try {
    const { first_name, last_name, email, phone, birth_date, goal } = req.body;
    if (!first_name || !last_name || !email)
      return res.status(400).json({ error: 'first_name, last_name, and email are required' });

    const result = db.run(
      "INSERT INTO CLIENT (first_name,last_name,email,phone,birth_date,join_date,goal) VALUES (?,?,?,?,?,date('now'),?)",
      [first_name, last_name, email, phone||null, birth_date||null, goal||null]
    );
    res.status(201).json(db.get('SELECT * FROM CLIENT WHERE client_id = ?', [result.lastInsertRowid]));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clients/:id', (req, res) => {
  try {
    const client = db.get('SELECT * FROM CLIENT WHERE client_id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { first_name, last_name, email, phone, birth_date, goal } = req.body;
    db.run(`
      UPDATE CLIENT SET
        first_name = COALESCE(?,first_name),
        last_name = COALESCE(?,last_name),
        email = COALESCE(?,email),
        phone = COALESCE(?,phone),
        birth_date = COALESCE(?,birth_date),
        goal = COALESCE(?,goal)
      WHERE client_id = ?
    `, [first_name||null, last_name||null, email||null, phone||null, birth_date||null, goal||null, req.params.id]);

    res.json(db.get('SELECT * FROM CLIENT WHERE client_id = ?', [req.params.id]));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/trainers/:id', (req, res) => {
  try {
    const trainer = db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [req.params.id]);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });

    db.run("UPDATE TRAINER_CLIENT SET status='inactive' WHERE trainer_id=?", [req.params.id]);
    db.run("UPDATE SESSION SET status='cancelled' WHERE trainer_id=? AND status='scheduled'", [req.params.id]);
    db.run('DELETE FROM TRAINER WHERE trainer_id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clients/:id', (req, res) => {
  try {
    const client = db.get('SELECT * FROM CLIENT WHERE client_id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    db.run('DELETE FROM TRAINER_CLIENT WHERE client_id=?', [req.params.id]);
    db.run('DELETE FROM SESSION WHERE client_id=?', [req.params.id]);
    db.run('DELETE FROM MEMBERSHIP WHERE client_id=?', [req.params.id]);
    db.run('DELETE FROM CLIENT WHERE client_id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ASSIGNMENTS ──────────────────────────────────────────────────────────────

app.get('/api/trainers/:id/clients', (req, res) => {
  try {
    const clients = db.all(`
      SELECT c.*, tc.assigned_date, tc.id as assignment_id
      FROM CLIENT c
      JOIN TRAINER_CLIENT tc ON c.client_id = tc.client_id
      WHERE tc.trainer_id = ? AND tc.status = 'active'
      ORDER BY c.first_name
    `, [req.params.id]);
    res.json(clients);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assignments', (req, res) => {
  try {
    const { trainer_id, client_id } = req.body;
    if (!trainer_id || !client_id)
      return res.status(400).json({ error: 'trainer_id and client_id are required' });

    const trainer = db.get('SELECT * FROM TRAINER WHERE trainer_id = ?', [trainer_id]);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found' });

    const client = db.get('SELECT * FROM CLIENT WHERE client_id = ?', [client_id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const currentCount = db.get(
      "SELECT COUNT(*) as cnt FROM TRAINER_CLIENT WHERE trainer_id = ? AND status = 'active'",
      [trainer_id]
    );

    if (currentCount.cnt >= trainer.max_clients) {
      return res.status(400).json({
        error: `Trainer ${trainer.first_name} ${trainer.last_name} has reached their maximum client limit (${trainer.max_clients})`
      });
    }

    db.run("UPDATE TRAINER_CLIENT SET status = 'inactive' WHERE client_id = ? AND status = 'active'", [client_id]);
    const result = db.run(
      "INSERT INTO TRAINER_CLIENT (trainer_id,client_id,assigned_date,status) VALUES (?,?,date('now'),'active')",
      [trainer_id, client_id]
    );
    const id = result.lastInsertRowid;
    res.status(201).json(db.get('SELECT * FROM TRAINER_CLIENT WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/assignments/:id', (req, res) => {
  try {
    const assignment = db.get('SELECT * FROM TRAINER_CLIENT WHERE id = ?', [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    db.run("UPDATE TRAINER_CLIENT SET status = 'inactive' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SESSIONS ────────────────────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  try {
    const { trainer_id, client_id } = req.query;
    let sql = `
      SELECT s.*,
        t.first_name || ' ' || t.last_name as trainer_name,
        c.first_name || ' ' || c.last_name as client_name
      FROM SESSION s
      JOIN TRAINER t ON s.trainer_id = t.trainer_id
      JOIN CLIENT c ON s.client_id = c.client_id
      WHERE s.scheduled_at >= datetime('now', '-1 day')
    `;
    const params = [];
    if (trainer_id) { sql += ' AND s.trainer_id = ?'; params.push(trainer_id); }
    if (client_id)  { sql += ' AND s.client_id = ?';  params.push(client_id); }
    sql += ' ORDER BY s.scheduled_at ASC LIMIT 50';
    res.json(db.all(sql, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions', (req, res) => {
  try {
    const { trainer_id, client_id, scheduled_at, duration_min, notes } = req.body;
    if (!trainer_id || !client_id || !scheduled_at)
      return res.status(400).json({ error: 'trainer_id, client_id, and scheduled_at are required' });

    const result = db.run(
      "INSERT INTO SESSION (trainer_id,client_id,scheduled_at,duration_min,status,notes) VALUES (?,?,?,?,'scheduled',?)",
      [trainer_id, client_id, scheduled_at, duration_min||60, notes||null]
    );
    res.status(201).json(db.get('SELECT * FROM SESSION WHERE session_id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/sessions/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['scheduled','completed','cancelled'].includes(status))
      return res.status(400).json({ error: 'status must be scheduled, completed, or cancelled' });

    const session = db.get('SELECT * FROM SESSION WHERE session_id = ?', [req.params.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    db.run('UPDATE SESSION SET status = ? WHERE session_id = ?', [status, req.params.id]);
    res.json(db.get('SELECT * FROM SESSION WHERE session_id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SCHEDULE ────────────────────────────────────────────────────────────────

app.get('/api/schedule', (req, res) => {
  try {
    const { trainer_id, from, to } = req.query;
    if (!trainer_id) return res.status(400).json({ error: 'trainer_id is required' });

    const sessions = db.all(`
      SELECT s.*,
        c.first_name || ' ' || c.last_name as client_name,
        c.goal as client_goal
      FROM SESSION s
      JOIN CLIENT c ON s.client_id = c.client_id
      WHERE s.trainer_id = ?
        AND s.scheduled_at >= ?
        AND s.scheduled_at <= ?
      ORDER BY s.scheduled_at ASC
    `, [trainer_id, from + ' 00:00', to + ' 23:59']);

    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── STATS ───────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const totalClients  = db.get('SELECT COUNT(*) as cnt FROM CLIENT').cnt;
    const totalTrainers = db.get('SELECT COUNT(*) as cnt FROM TRAINER').cnt;

    const sessionsThisWeek = db.get(`
      SELECT COUNT(*) as cnt FROM SESSION
      WHERE scheduled_at >= datetime('now', 'weekday 0', '-7 days')
        AND scheduled_at <= datetime('now', 'weekday 0')
        AND status != 'cancelled'
    `).cnt;

    const mostActiveTrainer = db.get(`
      SELECT t.first_name || ' ' || t.last_name as name,
        COUNT(s.session_id) as session_count
      FROM TRAINER t
      LEFT JOIN SESSION s ON t.trainer_id = s.trainer_id
        AND s.scheduled_at >= datetime('now', '-30 days')
        AND s.status != 'cancelled'
      GROUP BY t.trainer_id
      ORDER BY session_count DESC
      LIMIT 1
    `);

    const upcomingSessions = db.all(`
      SELECT s.*,
        t.first_name || ' ' || t.last_name as trainer_name,
        c.first_name || ' ' || c.last_name as client_name
      FROM SESSION s
      JOIN TRAINER t ON s.trainer_id = t.trainer_id
      JOIN CLIENT c ON s.client_id = c.client_id
      WHERE s.scheduled_at >= datetime('now')
        AND s.scheduled_at <= datetime('now', '+7 days')
        AND s.status = 'scheduled'
      ORDER BY s.scheduled_at ASC
    `);

    res.json({
      total_clients: totalClients,
      total_trainers: totalTrainers,
      sessions_this_week: sessionsThisWeek,
      most_active_trainer: mostActiveTrainer,
      upcoming_sessions: upcomingSessions,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── START ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

db.openDB().then(() => {
  db.initDB();
  db.seedDB();
  app.listen(PORT, () => {
    console.log(`\n🏋️  Gym Manager running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to open database:', err);
  process.exit(1);
});
