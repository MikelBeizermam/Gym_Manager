const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gym.db');

let db;

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function openDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
}

// Wrap sql.js to behave like better-sqlite3 (synchronous interface)
function exec(sql) {
  db.run(sql);
  saveDB();
}

function run(sql, params = []) {
  db.run(sql, params);
  const rowid = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? null;
  saveDB();
  return { lastInsertRowid: rowid, changes: db.getRowsModified() };
}

function get(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length || !res[0].values.length) return undefined;
  const cols = res[0].columns;
  const row = res[0].values[0];
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

function all(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// Prepare-like interface that accepts named params (@param) or positional (?)
function prepare(sql) {
  return {
    run: (...args) => {
      const params = args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? namedToPositional(sql, args[0])
        : { sql, params: args.flat() };
      return run(params.sql, params.params);
    },
    get: (...args) => {
      const params = args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? namedToPositional(sql, args[0])
        : { sql, params: args.flat() };
      return get(params.sql, params.params);
    },
    all: (...args) => {
      const params = args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? namedToPositional(sql, args[0])
        : { sql, params: args.flat() };
      return all(params.sql, params.params);
    },
  };
}

function namedToPositional(sql, obj) {
  const vals = [];
  const newSql = sql.replace(/@(\w+)/g, (_, name) => {
    vals.push(obj[name] !== undefined ? obj[name] : null);
    return '?';
  });
  return { sql: newSql, params: vals };
}

// Low-level run that skips auto-save (for use inside manual transactions)
function rawRun(sql, params = []) {
  db.run(sql, params);
  const res = db.exec('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: res[0]?.values[0][0] ?? null };
}

function transaction(fn) {
  return (...args) => {
    db.run('BEGIN TRANSACTION');
    try {
      // Temporarily replace run with rawRun so saveDB isn't called mid-tx
      const origRun = exports.run;
      exports.run = rawRun;
      const result = fn(...args);
      exports.run = origRun;
      db.run('COMMIT');
      saveDB();
      return result;
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (_) {}
      throw e;
    }
  };
}

function pragma(s) { db.run(`PRAGMA ${s}`); }

function dbExec(sql) { db.run(sql); saveDB(); }

function initDB() {
  db.run(`PRAGMA foreign_keys = ON`);
  db.run(`
    CREATE TABLE IF NOT EXISTS TRAINER (
      trainer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      specialization TEXT,
      max_clients INTEGER DEFAULT 10
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS CLIENT (
      client_id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      birth_date TEXT,
      join_date TEXT DEFAULT (date('now')),
      goal TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS TRAINER_CLIENT (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer_id INTEGER NOT NULL REFERENCES TRAINER(trainer_id),
      client_id INTEGER NOT NULL REFERENCES CLIENT(client_id),
      assigned_date TEXT DEFAULT (date('now')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS SESSION (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer_id INTEGER NOT NULL REFERENCES TRAINER(trainer_id),
      client_id INTEGER NOT NULL REFERENCES CLIENT(client_id),
      scheduled_at TEXT NOT NULL,
      duration_min INTEGER DEFAULT 60,
      status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
      notes TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS MEMBERSHIP (
      membership_id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES CLIENT(client_id),
      plan_type TEXT DEFAULT 'basic' CHECK(plan_type IN ('basic','premium','vip')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      price REAL
    )
  `);
  saveDB();
}

function seedDB() {
  const res = db.exec("SELECT COUNT(*) as cnt FROM TRAINER");
  const cnt = res[0]?.values[0][0] ?? 0;
  if (cnt > 0) return;

  const trainers = [
    ['דניאל', 'לוי', 'daniel.levi@gym.co.il', '050-1234567', 'כוח ומסה', 20],
    ['מיכל', 'כהן', 'michal.cohen@gym.co.il', '052-2345678', 'קרדיו וסיבולת', 20],
    ['יוסף', 'אברהם', 'yosef.avraham@gym.co.il', '054-3456789', 'יוגה ופילאטיס', 20],
    ['נועה', 'שפירא', 'noa.shapira@gym.co.il', '053-4567890', 'הרזיה ותזונה', 20],
    ['אמיר', 'ברקוביץ', 'amir.berkowitz@gym.co.il', '058-5678901', 'ספורט קרבי', 20],
  ];

  for (const t of trainers) {
    db.run('INSERT INTO TRAINER (first_name,last_name,email,phone,specialization,max_clients) VALUES (?,?,?,?,?,?)', t);
  }

  const clients = [
    ['רון', 'מזרחי', 'ron.mizrahi@mail.com', '050-1111111', '1990-03-15', 'בניית מסת שריר'],
    ['שירה', 'גולדברג', 'shira.goldberg@mail.com', '052-2222222', '1995-07-22', 'ירידה במשקל'],
    ['יעקב', 'פרידמן', 'yaakov.friedman@mail.com', '054-3333333', '1988-11-08', 'שיפור סיבולת'],
    ['תמר', 'רוזנברג', 'tamar.rosenberg@mail.com', '053-4444444', '1992-05-30', 'הגמשה וגמישות'],
    ['אלי', 'בן-דוד', 'eli.bendavid@mail.com', '058-5555555', '1985-09-12', 'כושר כללי'],
    ['חנה', 'שטיין', 'hana.stein@mail.com', '050-6666666', '1998-01-25', 'ירידה במשקל'],
    ['מושה', 'פרץ', 'moshe.peretz@mail.com', '052-7777777', '1980-06-14', 'בניית מסת שריר'],
    ['ליאת', 'עמית', 'liat.amit@mail.com', '054-8888888', '1993-12-03', 'שיפור סיבולת'],
    ['גיל', 'נחמן', 'gil.nachman@mail.com', '053-9999999', '1987-04-19', 'כושר קרבי'],
    ['אורית', 'כץ', 'orit.katz@mail.com', '058-0000000', '1996-08-07', 'הגמשה וגמישות'],
    ['ניר', 'הרצוג', 'nir.herzog@mail.com', '050-1212121', '1991-02-28', 'ירידה במשקל'],
    ['ענת', 'סגל', 'anat.segal@mail.com', '052-3434343', '1994-10-16', 'בניית מסת שריר'],
    ['בן', 'אלון', 'ben.alon@mail.com', '054-5656565', '1982-07-09', 'כושר כללי'],
    ['רחל', 'וייס', 'rachel.weiss@mail.com', '053-7878787', '1997-03-21', 'שיפור סיבולת'],
    ['אסף', 'נבון', 'asaf.navon@mail.com', '058-9090909', '1989-11-05', 'ספורט קרבי'],
    // 30 additional clients
    ['דנה', 'לבנה', 'dana.levana@mail.com', '050-1122334', '1993-06-10', 'ירידה במשקל'],
    ['יואב', 'קורן', 'yoav.koren@mail.com', '052-2233445', '1986-09-25', 'בניית מסת שריר'],
    ['מאיה', 'גרינברג', 'maya.greenberg@mail.com', '054-3344556', '1999-02-14', 'כושר כללי'],
    ['עמיר', 'שלום', 'amir.shalom@mail.com', '053-4455667', '1983-11-30', 'שיפור סיבולת'],
    ['טל', 'בירנבאום', 'tal.birnbaum@mail.com', '058-5566778', '1995-04-08', 'הגמשה וגמישות'],
    ['נטע', 'דרור', 'neta.dror@mail.com', '050-6677889', '1990-07-19', 'ירידה במשקל'],
    ['אריאל', 'מנדל', 'ariel.mandel@mail.com', '052-7788990', '1988-12-03', 'כושר קרבי'],
    ['כרמית', 'אשכנזי', 'carmit.ashkenazi@mail.com', '054-8899001', '1994-03-27', 'בניית מסת שריר'],
    ['שחר', 'פינקלשטיין', 'shachar.finkelstein@mail.com', '053-9900112', '1987-08-15', 'שיפור סיבולת'],
    ['לירן', 'בוזגלו', 'liran.buzaglo@mail.com', '058-0011223', '1992-01-22', 'כושר כללי'],
    ['הילה', 'אוחיון', 'hila.ohayon@mail.com', '050-1123456', '1997-05-11', 'הגמשה וגמישות'],
    ['אורן', 'מלכה', 'oren.malka@mail.com', '052-2234567', '1984-10-06', 'ירידה במשקל'],
    ['שני', 'ביטון', 'shani.biton@mail.com', '054-3345678', '1996-02-28', 'בניית מסת שריר'],
    ['אייל', 'חדד', 'eyal.haddad@mail.com', '053-4456789', '1981-07-17', 'ספורט קרבי'],
    ['מור', 'זכריה', 'mor.zacharia@mail.com', '058-5567890', '1998-11-09', 'כושר כללי'],
    ['יניב', 'אלבז', 'yaniv.elbaz@mail.com', '050-6678901', '1989-04-23', 'שיפור סיבולת'],
    ['ספיר', 'גבאי', 'sapir.gabai@mail.com', '052-7789012', '1993-09-14', 'ירידה במשקל'],
    ['רועי', 'שמואלי', 'roi.shmueli@mail.com', '054-8890123', '1985-06-05', 'בניית מסת שריר'],
    ['נועם', 'אביב', 'noam.aviv@mail.com', '053-9901234', '1991-01-30', 'כושר כללי'],
    ['אביגיל', 'לוינסון', 'avigail.levinson@mail.com', '058-0012345', '1994-08-18', 'הגמשה וגמישות'],
    ['גלעד', 'יצחקי', 'gilad.yitzhaki@mail.com', '050-1134567', '1982-03-12', 'ספורט קרבי'],
    ['שיר', 'כספי', 'shir.kaspi@mail.com', '052-2245678', '1996-10-24', 'ירידה במשקל'],
    ['דביר', 'מוסרי', 'dvir.mosseri@mail.com', '054-3356789', '1988-05-07', 'שיפור סיבולת'],
    ['יעל', 'אזרד', 'yael.azrad@mail.com', '053-4467890', '1999-12-20', 'כושר כללי'],
    ['אלעד', 'חיים', 'elad.haim@mail.com', '058-5578901', '1986-07-03', 'בניית מסת שריר'],
    ['ליה', 'סדון', 'lia.sadon@mail.com', '050-6689012', '1990-02-16', 'הגמשה וגמישות'],
    ['תומר', 'בן-עזרא', 'tomer.benezra@mail.com', '052-7790123', '1983-09-29', 'ספורט קרבי'],
    ['ורד', 'מיכאלי', 'vered.michaeli@mail.com', '054-8801234', '1995-04-11', 'ירידה במשקל'],
    ['אמית', 'שדה', 'amit.sade@mail.com', '053-9912345', '1987-11-25', 'שיפור סיבולת'],
    ['נדב', 'ארד', 'nadav.arad@mail.com', '058-0023456', '1992-06-08', 'כושר כללי'],
  ];

  const today = new Date();
  for (let i = 0; i < clients.length; i++) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - Math.floor(Math.random() * 12));
    const joinDate = d.toISOString().split('T')[0];
    db.run('INSERT INTO CLIENT (first_name,last_name,email,phone,birth_date,join_date,goal) VALUES (?,?,?,?,?,?,?)',
      [...clients[i], joinDate]);
  }

  // Distribute 45 clients across 5 trainers (9 each)
  const assignments = [
    [1,1],[1,2],[1,3],[1,16],[1,17],[1,18],[1,19],[1,20],[1,21],
    [2,4],[2,5],[2,6],[2,7],[2,22],[2,23],[2,24],[2,25],[2,26],
    [3,8],[3,9],[3,10],[3,27],[3,28],[3,29],[3,30],[3,31],[3,32],
    [4,11],[4,12],[4,13],[4,33],[4,34],[4,35],[4,36],[4,37],[4,38],
    [5,14],[5,15],[5,39],[5,40],[5,41],[5,42],[5,43],[5,44],[5,45],
  ];

  for (const [tid, cid] of assignments) {
    db.run("INSERT INTO TRAINER_CLIENT (trainer_id,client_id,assigned_date,status) VALUES (?,?,date('now'),'active')", [tid, cid]);
  }

  const plans = ['basic','premium','vip'];
  const prices = { basic: 150, premium: 280, vip: 450 };
  for (let i = 1; i <= 45; i++) {
    const plan = plans[Math.floor(Math.random() * plans.length)];
    const start = new Date(today);
    start.setMonth(start.getMonth() - Math.floor(Math.random() * 4));
    const end = new Date(start);
    end.setMonth(end.getMonth() + (i % 4 === 0 ? -1 : 6));
    db.run('INSERT INTO MEMBERSHIP (client_id,plan_type,start_date,end_date,price) VALUES (?,?,?,?,?)',
      [i, plan, start.toISOString().split('T')[0], end.toISOString().split('T')[0], prices[plan]]);
  }

  // trainer_id, client_id, day_offset, hour, duration, status, notes
  const sessionData = [
    // ── עבר ──────────────────────────────────────────────
    [1,  3, -4,  9, 60, 'completed', 'אימון כוח - הושלם'],
    [2,  6, -3, 10, 60, 'completed', 'קרדיו - הושלם'],
    [3,  9, -3, 16, 60, 'completed', 'פילאטיס - הושלם'],
    [4, 12, -2, 14, 60, 'completed', 'מעקב ירידה במשקל - הושלם'],
    [5, 15, -2, 17, 90, 'completed', 'אימון קרב - הושלם'],
    [1, 20, -5,  8, 60, 'cancelled', 'בוטל ע"י לקוח'],
    [3, 10, -4, 12, 45, 'cancelled', 'ביטול - מחלה'],

    // ── היום (day 0) ─────────────────────────────────────
    [1,  1, 0,  8, 60, 'scheduled', 'אימון כוח עליון'],
    [2,  4, 0, 10, 60, 'scheduled', 'ריצת אינטרוול'],
    [3,  8, 0,  9, 90, 'scheduled', 'יוגה למתחילים'],
    [4, 11, 0, 11, 60, 'scheduled', 'תוכנית ירידה במשקל'],
    [5, 14, 0, 15, 60, 'scheduled', 'בסיסי קרב'],

    // ── יום 1 ────────────────────────────────────────────
    [1,  2, 1,  8, 90, 'scheduled', 'אימון רגליים'],
    [2, 23, 1, 10, 60, 'scheduled', 'ריצת טמפו'],
    [3, 27, 1, 13, 60, 'scheduled', 'יוגה מתקדמת'],
    [4, 34, 1, 16, 45, 'scheduled', 'אימון אינטנסיבי'],
    [5, 41, 1, 11, 60, 'scheduled', 'טכניקת קרב'],

    // ── יום 2 ────────────────────────────────────────────
    [1, 16, 2, 10, 60, 'scheduled', 'כוח - מתחיל'],
    [2,  7, 2,  9, 60, 'scheduled', 'סיבולת מתקדם'],
    [3, 29, 2, 14, 90, 'scheduled', 'מדיטציה ויוגה'],
    [5, 39, 2,  8, 60, 'scheduled', 'אגרוף ובעיטות'],

    // ── יום 3 ────────────────────────────────────────────
    [1, 18, 3,  7, 90, 'scheduled', 'גב וכתפיים'],
    [2, 22, 3, 11, 60, 'scheduled', 'קרדיו מתקדם'],
    [3,  9, 3,  9, 60, 'scheduled', 'פילאטיס'],
    [4, 33, 3, 14, 60, 'scheduled', 'תוכנית כושר'],
    [5, 42, 3, 16, 90, 'scheduled', 'קרב מגע'],

    // ── יום 4 ────────────────────────────────────────────
    [1,  3, 4,  9, 60, 'scheduled', 'כוח תחתון'],
    [2,  5, 4, 12, 45, 'scheduled', 'קרדיו בוקר'],
    [4, 35, 4, 10, 60, 'scheduled', 'ניהול משקל'],
    [5, 15, 4, 15, 60, 'scheduled', 'הגנה עצמית'],

    // ── יום 5 ────────────────────────────────────────────
    [1, 19, 5, 10, 60, 'scheduled', 'ליבה ויציבות'],
    [2, 24, 5,  9, 60, 'scheduled', 'ריצה ארוכה'],
    [3, 30, 5, 11, 90, 'scheduled', 'יוגה שישי'],
    [4, 13, 5, 14, 60, 'scheduled', 'הערכת שבוע'],
    [5, 43, 5,  8, 60, 'scheduled', 'אימון קרב'],

    // ── יום 6 ────────────────────────────────────────────
    [1,  2, 6, 10, 60, 'scheduled', 'רגליים שבת'],
    [2,  6, 6, 12, 45, 'scheduled', 'קרדיו קל שבת'],
    [3, 31, 6,  9, 60, 'scheduled', 'פילאטיס שבת'],
    [4, 36, 6, 11, 90, 'scheduled', 'HIIT שבת'],
    [5, 44, 6, 15, 60, 'scheduled', 'קרב שבת'],

    // ── יום 7 ────────────────────────────────────────────
    [1, 17, 7,  8, 60, 'scheduled', 'פתיחת שבוע'],
    [2, 25, 7, 10, 60, 'scheduled', 'קרדיו פתיחת שבוע'],
    [3, 28, 7, 11, 60, 'scheduled', 'יוגה ראשון'],
    [4, 11, 7, 14, 60, 'scheduled', 'מעקב שבועי'],
    [5, 40, 7,  9, 90, 'scheduled', 'קרב - שבוע חדש'],
  ];

  for (const [tid, cid, days, hour, dur, status, notes] of sessionData) {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    const dt = d.toISOString().replace('T', ' ').substring(0, 16);
    db.run('INSERT INTO SESSION (trainer_id,client_id,scheduled_at,duration_min,status,notes) VALUES (?,?,?,?,?,?)',
      [tid, cid, dt, dur, status, notes]);
  }

  saveDB();
  console.log('Database seeded with sample data.');
}

module.exports = { openDB, initDB, seedDB, prepare, run, get, all, exec: dbExec, transaction };
