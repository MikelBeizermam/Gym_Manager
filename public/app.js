// ── helpers ───────────────────────────────────────────────────────────────────
const state = {
  trainers: [],
  clients: [],
  selectedClientId: null,
  selectedTrainerId: null,
  currentView: 'dashboard',
};

const $ = id => document.getElementById(id);
const ic = name => `<i data-lucide="${name}"></i>`;
const renderIcons = () => lucide.createIcons();

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'הבקשה נכשלה');
  return data;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${ic(type === 'success' ? 'check' : 'x')} ${msg}`;
  $('toast-container').appendChild(el);
  renderIcons();
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d.replace(' ', 'T')).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function initials(first, last) {
  return ((first || '')[0] || '') + ((last || '')[0] || '');
}

function progressClass(count, max) {
  const pct = count / max;
  if (pct >= 1) return 'full';
  if (pct >= 0.75) return 'warn';
  return '';
}

const LABELS = {
  scheduled: 'מתוכנן', completed: 'הושלם', cancelled: 'בוטל',
  active: 'פעיל', inactive: 'לא פעיל', expired: 'פג תוקף',
  basic: 'בסיסי', premium: 'פרמיום', vip: 'VIP',
};
const lbl = key => LABELS[key] || key;

// ── confirm delete ─────────────────────────────────────────────────────────────
function confirmDelete({ title, description, onConfirm }) {
  const container = $('modal-container');
  container.innerHTML = `
    <div class="form-overlay" id="modal-overlay">
      <div class="confirm-modal">
        <div class="confirm-icon">${ic('trash-2')}</div>
        <h3>${title}</h3>
        <p>${description}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-danger" id="confirm-yes">כן, מחק</button>
          <button type="button" class="btn btn-secondary" id="confirm-no">ביטול</button>
        </div>
      </div>
    </div>`;
  renderIcons();

  const close = () => container.innerHTML = '';
  $('confirm-no').addEventListener('click', close);
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) close(); });
  $('confirm-yes').addEventListener('click', async () => {
    $('confirm-yes').disabled = true;
    $('confirm-yes').textContent = 'מוחק...';
    try { await onConfirm(); close(); }
    catch (e) { toast(e.message, 'error'); close(); }
  });
}

async function deleteTrainer(trainerId, name) {
  confirmDelete({
    title: 'מחיקת מאמן',
    description: `האם למחוק את <strong>${name}</strong>?<br>כל השיוכים והאימונים שלו יבוטלו.`,
    onConfirm: async () => {
      await api(`/trainers/${trainerId}`, { method: 'DELETE' });
      toast('המאמן נמחק בהצלחה');
      if (state.selectedTrainerId === trainerId) showTrainerForm();
      await loadTrainers();
    }
  });
}

async function deleteClient(clientId, name) {
  confirmDelete({
    title: 'מחיקת לקוח',
    description: `האם למחוק את <strong>${name}</strong>?<br>כל המנויים והאימונים יימחקו.`,
    onConfirm: async () => {
      await api(`/clients/${clientId}`, { method: 'DELETE' });
      toast('הלקוח נמחק בהצלחה');
      state.selectedClientId = null;
      showClientPlaceholder();
      await loadClients();
    }
  });
}

// ── navigation ────────────────────────────────────────────────────────────────
const titles = { dashboard: 'לוח בקרה', trainers: 'מאמנים', clients: 'לקוחות', schedule: 'יומן אישי' };

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(`view-${view}`).classList.add('active');
    $('page-title').textContent = titles[view];
    state.currentView = view;
    if (view === 'dashboard') loadDashboard();
    if (view === 'trainers') loadTrainers();
    if (view === 'clients') loadClients();
    if (view === 'schedule') { populateScheduleTrainers(); updateWeekLabel(); if (scheduleState.trainerId) loadSchedule(); }
  });
});

// ── dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const stats = await api('/stats');
    $('stat-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon">${ic('users')}</div>
        <div class="stat-info"><h3>${stats.total_clients}</h3><p>סה"כ לקוחות</p></div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon">${ic('briefcase')}</div>
        <div class="stat-info"><h3>${stats.total_trainers}</h3><p>סה"כ מאמנים</p></div>
      </div>
      <div class="stat-card orange">
        <div class="stat-icon">${ic('calendar')}</div>
        <div class="stat-info"><h3>${stats.sessions_this_week}</h3><p>אימונים השבוע</p></div>
      </div>
      <div class="stat-card blue">
        <div class="stat-icon">${ic('trophy')}</div>
        <div class="stat-info">
          <h3 style="font-size:15px;line-height:1.3">${stats.most_active_trainer?.name || '—'}</h3>
          <p>המאמן הפעיל ביותר</p>
        </div>
      </div>`;

    if (!stats.upcoming_sessions.length) {
      $('sessions-table-body').innerHTML = `
        <div class="empty-state">
          ${ic('calendar')}
          <h3>אין אימונים קרובים</h3>
        </div>`;
      renderIcons();
      return;
    }

    $('sessions-table-body').innerHTML = `
      <table>
        <thead><tr>
          <th>תאריך ושעה</th><th>לקוח</th><th>מאמן</th><th>משך</th><th>סטטוס</th><th>הערות</th>
        </tr></thead>
        <tbody>
          ${stats.upcoming_sessions.map(s => `
            <tr>
              <td>${fmtDateTime(s.scheduled_at)}</td>
              <td><strong>${s.client_name}</strong></td>
              <td>${s.trainer_name}</td>
              <td>${s.duration_min} דק'</td>
              <td><span class="badge badge-${s.status}">${lbl(s.status)}</span></td>
              <td style="color:var(--text-muted);font-size:12px">${s.notes || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    renderIcons();
  } catch (e) { toast(e.message, 'error'); }
}

// ── trainers ──────────────────────────────────────────────────────────────────
async function loadTrainers() {
  try {
    state.trainers = await api('/trainers');
    renderTrainersTable();
    if (!state.selectedTrainerId) showTrainerForm();
  } catch (e) { toast(e.message, 'error'); }
}

function renderTrainersTable() {
  const el = $('trainer-table-body');
  $('trainer-count').textContent = state.trainers.length;

  if (!state.trainers.length) {
    el.innerHTML = `<div class="empty-state">${ic('briefcase')}<h3>אין מאמנים עדיין</h3></div>`;
    renderIcons();
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>שם</th><th>התמחות</th><th>לקוחות</th><th>טלפון</th><th></th>
      </tr></thead>
      <tbody>
        ${state.trainers.map(t => {
          const pct = Math.round((t.client_count / t.max_clients) * 100);
          const cls = progressClass(t.client_count, t.max_clients);
          return `
            <tr class="clickable ${state.selectedTrainerId === t.trainer_id ? 'selected' : ''}"
                onclick="selectTrainer(${t.trainer_id})">
              <td>
                <div class="entity-cell">
                  <div class="entity-avatar">${initials(t.first_name, t.last_name)}</div>
                  <div>
                    <div class="entity-name">${t.first_name} ${t.last_name}</div>
                    <div class="entity-sub">${t.email}</div>
                  </div>
                </div>
              </td>
              <td style="color:var(--text-muted);font-size:12px">${t.specialization || '—'}</td>
              <td>
                <div class="progress-mini">
                  <div class="progress-mini-bar">
                    <div class="progress-mini-fill ${cls}" style="width:${pct}%"></div>
                  </div>
                  <span>${t.client_count}/${t.max_clients}</span>
                </div>
              </td>
              <td style="font-size:12px;color:var(--text-muted)">${t.phone || '—'}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="row-btn" title="עריכה"
                    onclick="event.stopPropagation();selectTrainer(${t.trainer_id})">${ic('pencil')}</button>
                  <button type="button" class="row-btn danger" title="מחיקה"
                    onclick="event.stopPropagation();deleteTrainer(${t.trainer_id},'${t.first_name} ${t.last_name}')">${ic('trash-2')}</button>
                </div>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  renderIcons();
}

async function selectTrainer(trainerId) {
  state.selectedTrainerId = trainerId;
  renderTrainersTable();
  const trainer = state.trainers.find(t => t.trainer_id === trainerId);
  if (trainer) showTrainerDetail(trainer);
}

function showTrainerDetail(trainer) {
  $('trainer-aside').querySelector('.aside-card-header h3').textContent = `${trainer.first_name} ${trainer.last_name}`;

  $('trainer-aside-body').innerHTML = `
    <div class="info-section">
      <div class="info-row"><span class="lbl">התמחות</span><span class="val">${trainer.specialization || '—'}</span></div>
      <div class="info-row"><span class="lbl">דוא"ל</span><span class="val" style="font-size:12px">${trainer.email}</span></div>
      <div class="info-row"><span class="lbl">טלפון</span><span class="val">${trainer.phone || '—'}</span></div>
      <div class="info-row"><span class="lbl">מקס׳ לקוחות</span><span class="val">${trainer.max_clients}</span></div>
    </div>

    <div class="divider"></div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px">לקוחות משויכים</span>
      ${trainer.client_count < trainer.max_clients
        ? `<div class="assign-dropdown" id="assign-drop-${trainer.trainer_id}">
             <button type="button" class="btn btn-primary btn-sm" onclick="toggleAssignDropdown(${trainer.trainer_id})">
               ${ic('user-plus')} שיוך
             </button>
             <div class="assign-dropdown-menu" id="assign-menu-${trainer.trainer_id}"></div>
           </div>`
        : `<span class="badge badge-inactive">מלא</span>`
      }
    </div>
    <div id="trainer-clients-list-${trainer.trainer_id}"><div class="loading"><div class="spinner"></div></div></div>

    <div class="form-actions-aside" style="margin-top:16px">
      <button type="button" class="btn btn-secondary btn-sm" onclick="showTrainerForm(${JSON.stringify(trainer).replace(/"/g,'&quot;')})">
        ${ic('pencil')} עריכה
      </button>
      <button type="button" class="btn btn-danger btn-sm" onclick="deleteTrainer(${trainer.trainer_id},'${trainer.first_name} ${trainer.last_name}')">
        ${ic('trash-2')} מחיקה
      </button>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-right:auto" onclick="showTrainerForm()">
        ${ic('plus')} חדש
      </button>
    </div>`;

  renderIcons();
  loadTrainerClientsList(trainer.trainer_id);
}

async function loadTrainerClientsList(trainerId) {
  const el = $(`trainer-clients-list-${trainerId}`);
  if (!el) return;
  try {
    const clients = await api(`/trainers/${trainerId}/clients`);
    if (!clients.length) {
      el.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">אין לקוחות משויכים עדיין.</p>';
      return;
    }
    el.innerHTML = `<div class="client-chips">${clients.map(c => `
      <div class="client-chip">
        <span>${initials(c.first_name, c.last_name)}</span>
        <span>${c.first_name} ${c.last_name}</span>
        <button onclick="removeAssignment(${c.assignment_id},${trainerId})" title="הסר">${ic('x')}</button>
      </div>`).join('')}</div>`;
    renderIcons();
  } catch (e) { toast(e.message, 'error'); }
}

function showTrainerForm(trainer = null) {
  state.selectedTrainerId = null;
  renderTrainersTable();
  const isEdit = !!trainer;
  $('trainer-aside').querySelector('.aside-card-header h3').textContent = isEdit ? 'עריכת מאמן' : 'הוספת מאמן';

  $('trainer-aside-body').innerHTML = `
    <div class="field-row">
      <div class="field"><label>שם פרטי *</label><input type="text" id="f-first" value="${trainer?.first_name || ''}" placeholder="שם פרטי"></div>
      <div class="field"><label>שם משפחה *</label><input type="text" id="f-last" value="${trainer?.last_name || ''}" placeholder="שם משפחה"></div>
    </div>
    <div class="field"><label>דוא"ל *</label><input type="email" id="f-email" value="${trainer?.email || ''}" placeholder="email@gym.com"></div>
    <div class="field-row">
      <div class="field"><label>טלפון</label><input type="text" id="f-phone" value="${trainer?.phone || ''}" placeholder="050-0000000"></div>
      <div class="field"><label>מקס׳ לקוחות</label><input type="number" id="f-max" value="${trainer?.max_clients || 10}" min="1" max="99"></div>
    </div>
    <div class="field"><label>התמחות</label><input type="text" id="f-spec" value="${trainer?.specialization || ''}" placeholder="כוח ומסה, קרדיו..."></div>
    <div class="form-actions-aside">
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-trainer">
        ${ic('save')} שמור
      </button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="showTrainerForm()">ניקוי</button>
    </div>`;
  renderIcons();

  $('btn-save-trainer').addEventListener('click', async () => {
    const body = {
      first_name: $('f-first').value.trim(),
      last_name: $('f-last').value.trim(),
      email: $('f-email').value.trim(),
      phone: $('f-phone').value.trim(),
      specialization: $('f-spec').value.trim(),
      max_clients: parseInt($('f-max').value) || 10,
    };
    if (!body.first_name || !body.last_name || !body.email) { toast('אנא מלא את השדות הנדרשים', 'error'); return; }
    try {
      $('btn-save-trainer').disabled = true;
      if (isEdit) {
        await api(`/trainers/${trainer.trainer_id}`, { method: 'PUT', body });
        toast('המאמן עודכן בהצלחה');
      } else {
        await api('/trainers', { method: 'POST', body });
        toast('המאמן נוסף בהצלחה');
      }
      await loadTrainers();
    } catch (e) { toast(e.message, 'error'); $('btn-save-trainer').disabled = false; }
  });
}

async function toggleAssignDropdown(trainerId) {
  const menu = $(`assign-menu-${trainerId}`);
  menu.classList.toggle('open');
  if (!menu.classList.contains('open')) return;
  try {
    const allClients = await api('/clients');
    const unassigned = allClients.filter(c => !c.assignment_id);
    if (!unassigned.length) {
      menu.innerHTML = '<div class="assign-option" style="color:var(--text-muted)">כל הלקוחות משויכים</div>';
      return;
    }
    menu.innerHTML = unassigned.map(c => `
      <div class="assign-option" onclick="assignClient(${trainerId},${c.client_id})">
        ${c.first_name} ${c.last_name}
        <span style="color:var(--text-muted);font-size:11px"> — ${c.goal || ''}</span>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.assign-dropdown'))
    document.querySelectorAll('.assign-dropdown-menu.open').forEach(m => m.classList.remove('open'));
});

async function assignClient(trainerId, clientId) {
  try {
    await api('/assignments', { method: 'POST', body: { trainer_id: trainerId, client_id: clientId } });
    toast('הלקוח שויך בהצלחה');
    document.querySelectorAll('.assign-dropdown-menu.open').forEach(m => m.classList.remove('open'));
    await loadTrainers();
    selectTrainer(trainerId);
  } catch (e) { toast(e.message, 'error'); }
}

async function removeAssignment(assignmentId, trainerId) {
  try {
    await api(`/assignments/${assignmentId}`, { method: 'DELETE' });
    toast('השיוך הוסר');
    await loadTrainers();
    selectTrainer(trainerId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── clients ───────────────────────────────────────────────────────────────────
async function loadClients() {
  try {
    state.clients = await api('/clients');
    renderClientsTable(state.clients);
    if (!state.selectedClientId) showClientPlaceholder();
  } catch (e) { toast(e.message, 'error'); }
}

function renderClientsTable(clients) {
  $('client-count').textContent = clients.length;
  if (!clients.length) {
    $('clients-table-body').innerHTML = `<div class="empty-state">${ic('users')}<h3>לא נמצאו לקוחות</h3></div>`;
    renderIcons();
    return;
  }
  $('clients-table-body').innerHTML = `
    <table>
      <thead><tr>
        <th>שם</th><th>מטרה</th><th>מאמן</th><th>מנוי</th><th>תכנית</th><th></th>
      </tr></thead>
      <tbody>
        ${clients.map(c => `
          <tr class="clickable ${state.selectedClientId === c.client_id ? 'selected' : ''}"
              onclick="openClientAside(${c.client_id})">
            <td>
              <div class="entity-cell">
                <div class="entity-avatar">${initials(c.first_name, c.last_name)}</div>
                <div>
                  <div class="entity-name">${c.first_name} ${c.last_name}</div>
                  <div class="entity-sub">${c.email}</div>
                </div>
              </div>
            </td>
            <td style="color:var(--text-muted);font-size:12px">${c.goal || '—'}</td>
            <td style="font-size:12px">${c.trainer_name || '<span style="color:var(--text-muted)">ללא</span>'}</td>
            <td><span class="badge badge-${c.membership_status || 'expired'}">${lbl(c.membership_status) || 'אין'}</span></td>
            <td><span class="badge badge-${c.plan_type || ''}">${c.plan_type ? lbl(c.plan_type) : '—'}</span></td>
            <td>
              <div class="row-actions">
                <button type="button" class="row-btn danger" title="מחיקה"
                  onclick="event.stopPropagation();deleteClient(${c.client_id},'${c.first_name} ${c.last_name}')">${ic('trash-2')}</button>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  renderIcons();
}

$('client-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderClientsTable(state.clients.filter(c =>
    `${c.first_name} ${c.last_name} ${c.email} ${c.goal || ''} ${c.trainer_name || ''}`.toLowerCase().includes(q)
  ));
});

$('btn-add-client').addEventListener('click', () => showClientFormAside());

function showClientPlaceholder() {
  $('client-aside-title').textContent = 'פרטי לקוח';
  $('client-aside-close').classList.remove('visible');
  $('client-aside-body').innerHTML = `
    <div class="aside-empty-state">
      <i data-lucide="user" class="empty-icon"></i>
      <p>בחר לקוח מהרשימה לצפייה בפרטים</p>
    </div>`;
  renderIcons();
}

async function openClientAside(clientId) {
  state.selectedClientId = clientId;
  renderClientsTable(state.clients);
  $('client-aside-title').textContent = 'טוען...';
  $('client-aside-close').classList.add('visible');
  $('client-aside-body').innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const c = await api(`/clients/${clientId}`);
    $('client-aside-title').textContent = `${c.first_name} ${c.last_name}`;

    const trainerOptions = state.trainers.map(t =>
      `<option value="${t.trainer_id}" ${c.trainer_id == t.trainer_id ? 'selected' : ''}>${t.first_name} ${t.last_name}</option>`
    ).join('');

    $('client-aside-body').innerHTML = `
      <div class="info-section">
        <div class="info-section-title">פרטים אישיים</div>
        <div class="info-row"><span class="lbl">דוא"ל</span><span class="val" style="font-size:12px">${c.email}</span></div>
        <div class="info-row"><span class="lbl">טלפון</span><span class="val">${c.phone || '—'}</span></div>
        <div class="info-row"><span class="lbl">תאריך לידה</span><span class="val">${fmtDate(c.birth_date)}</span></div>
        <div class="info-row"><span class="lbl">הצטרפות</span><span class="val">${fmtDate(c.join_date)}</span></div>
        <div class="info-row"><span class="lbl">מטרה</span><span class="val">${c.goal || '—'}</span></div>
      </div>

      <div class="info-section">
        <div class="info-section-title">מאמן</div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="panel-trainer-select" class="field" style="margin:0;flex:1;padding:7px 10px;font-size:12px">
            <option value="">— ללא מאמן —</option>
            ${trainerOptions}
          </select>
          <button type="button" class="btn btn-primary btn-sm" onclick="changeTrainer(${c.client_id})">שמור</button>
        </div>
        ${c.assigned_date ? `<p style="font-size:11px;color:var(--text-muted);margin-top:5px">משויך מ-${fmtDate(c.assigned_date)}</p>` : ''}
      </div>

      ${c.membership ? `
        <div class="info-section">
          <div class="info-section-title">מנוי</div>
          <div class="membership-card">
            <div class="plan-name">תכנית ${lbl(c.membership.plan_type)}</div>
            <div class="plan-dates">${fmtDate(c.membership.start_date)} ← ${fmtDate(c.membership.end_date)}</div>
            <div class="plan-price">₪${c.membership.price} / חודש</div>
          </div>
          <span class="badge badge-${c.membership.status}">${lbl(c.membership.status)}</span>
        </div>` : `
        <div class="info-section">
          <div class="info-section-title">מנוי</div>
          <p style="color:var(--text-muted);font-size:13px">אין מנוי פעיל</p>
        </div>`}

      <div class="info-section">
        <div class="info-section-title">היסטוריית אימונים</div>
        ${!c.sessions.length
          ? '<p style="color:var(--text-muted);font-size:13px">אין אימונים עדיין</p>'
          : c.sessions.slice(0, 6).map(s => `
              <div class="session-item">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div class="session-date">${fmtDateTime(s.scheduled_at)}</div>
                  <span class="badge badge-${s.status}">${lbl(s.status)}</span>
                </div>
                <div class="session-meta">${s.duration_min} דק' • ${s.trainer_name}</div>
              </div>`).join('')}
      </div>

      <div class="form-actions-aside">
        <button type="button" class="btn btn-secondary btn-sm" onclick="showClientFormAside(${JSON.stringify(c).replace(/"/g,'&quot;')})">
          ${ic('pencil')} עריכה
        </button>
        <button type="button" class="btn btn-danger btn-sm" onclick="deleteClient(${c.client_id},'${c.first_name} ${c.last_name}')">
          ${ic('trash-2')} מחיקה
        </button>
      </div>`;
    renderIcons();
  } catch (e) {
    toast(e.message, 'error');
    $('client-aside-body').innerHTML = `<p style="color:var(--danger);padding:16px">שגיאה בטעינת פרטי הלקוח.</p>`;
  }
}

$('client-aside-close').addEventListener('click', () => {
  state.selectedClientId = null;
  $('client-aside-close').classList.remove('visible');
  renderClientsTable(state.clients);
  showClientPlaceholder();
});

function showClientFormAside(client = null) {
  const isEdit = !!client;
  state.selectedClientId = null;
  renderClientsTable(state.clients);
  $('client-aside-title').textContent = isEdit ? 'עריכת לקוח' : 'הוספת לקוח';
  $('client-aside-close').classList.add('visible');

  $('client-aside-body').innerHTML = `
    <div class="field-row">
      <div class="field"><label>שם פרטי *</label><input type="text" id="cf-first" value="${client?.first_name || ''}" placeholder="שם פרטי"></div>
      <div class="field"><label>שם משפחה *</label><input type="text" id="cf-last" value="${client?.last_name || ''}" placeholder="שם משפחה"></div>
    </div>
    <div class="field"><label>דוא"ל *</label><input type="email" id="cf-email" value="${client?.email || ''}" placeholder="client@email.com"></div>
    <div class="field-row">
      <div class="field"><label>טלפון</label><input type="text" id="cf-phone" value="${client?.phone || ''}" placeholder="050-0000000"></div>
      <div class="field"><label>תאריך לידה</label><input type="date" id="cf-birth" value="${client?.birth_date || ''}"></div>
    </div>
    <div class="field"><label>מטרה</label><input type="text" id="cf-goal" value="${client?.goal || ''}" placeholder="ירידה במשקל, בניית שריר..."></div>
    <div class="form-actions-aside">
      <button type="button" class="btn btn-primary btn-sm" id="btn-save-client">
        ${ic('save')} שמור
      </button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="showClientPlaceholder()">ביטול</button>
    </div>`;
  renderIcons();

  $('btn-save-client').addEventListener('click', async () => {
    const body = {
      first_name: $('cf-first').value.trim(),
      last_name: $('cf-last').value.trim(),
      email: $('cf-email').value.trim(),
      phone: $('cf-phone').value.trim(),
      birth_date: $('cf-birth').value || null,
      goal: $('cf-goal').value.trim(),
    };
    if (!body.first_name || !body.last_name || !body.email) { toast('אנא מלא את השדות הנדרשים', 'error'); return; }
    try {
      $('btn-save-client').disabled = true;
      if (isEdit) {
        await api(`/clients/${client.client_id}`, { method: 'PUT', body });
        toast('הלקוח עודכן בהצלחה');
        await loadClients();
        openClientAside(client.client_id);
      } else {
        await api('/clients', { method: 'POST', body });
        toast('הלקוח נוסף בהצלחה');
        await loadClients();
        showClientPlaceholder();
      }
    } catch (e) { toast(e.message, 'error'); $('btn-save-client').disabled = false; }
  });
}

async function changeTrainer(clientId) {
  const select = $('panel-trainer-select');
  const trainerId = select?.value;
  try {
    if (trainerId) {
      await api('/assignments', { method: 'POST', body: { trainer_id: parseInt(trainerId), client_id: clientId } });
    } else {
      const client = state.clients.find(c => c.client_id === clientId);
      if (client?.assignment_id) await api(`/assignments/${client.assignment_id}`, { method: 'DELETE' });
    }
    toast('המאמן עודכן בהצלחה');
    await loadClients();
    openClientAside(clientId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── schedule ──────────────────────────────────────────────────────────────────
const scheduleState = { trainerId: null, weekStart: getWeekStart(new Date()) };
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HOUR_START = 6, HOUR_END = 22, HOUR_H = 64;

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtIsoDate(d) { return d.toISOString().split('T')[0]; }

function updateWeekLabel() {
  const end = new Date(scheduleState.weekStart);
  end.setDate(end.getDate() + 6);
  $('week-label').textContent = `${fmtDate(fmtIsoDate(scheduleState.weekStart))} – ${fmtDate(fmtIsoDate(end))}`;
}

async function populateScheduleTrainers() {
  const sel = $('schedule-trainer-select');
  if (sel.options.length > 1) return;
  try {
    const trainers = await api('/trainers');
    trainers.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.trainer_id;
      opt.textContent = `${t.first_name} ${t.last_name} — ${t.specialization || 'מאמן'}`;
      sel.appendChild(opt);
    });
    // auto-select first trainer
    if (trainers.length && !scheduleState.trainerId) {
      sel.value = trainers[0].trainer_id;
      scheduleState.trainerId = trainers[0].trainer_id;
      loadSchedule();
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function loadSchedule() {
  if (!scheduleState.trainerId) return;
  $('schedule-content').innerHTML = '<div class="loading"><div class="spinner"></div> טוען לוח זמנים...</div>';
  const weekEnd = new Date(scheduleState.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  try {
    const sessions = await api(`/schedule?trainer_id=${scheduleState.trainerId}&from=${fmtIsoDate(scheduleState.weekStart)}&to=${fmtIsoDate(weekEnd)}`);
    renderCalendar(sessions);
  } catch (e) {
    toast(e.message, 'error');
    $('schedule-content').innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle" class="empty-icon"></i><h3>שגיאה בטעינת לוח הזמנים</h3></div>`;
    renderIcons();
  }
}

function renderCalendar(sessions) {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(scheduleState.weekStart); d.setDate(d.getDate() + i); return d; });
  const byDay = Array.from({ length: 7 }, () => []);
  for (const s of sessions) { const dt = new Date(s.scheduled_at.replace(' ', 'T')); byDay[dt.getDay()].push({ ...s, dt }); }

  const headerHtml = `<div class="cal-header"><div class="cal-header-time"></div>${weekDays.map((d, i) => {
    const isToday = d.getTime() === today.getTime();
    return `<div class="cal-day-header ${isToday ? 'today' : ''}">
      <span class="day-name">${DAY_NAMES[i]}</span>
      <span class="day-date">${d.getDate()}/${d.getMonth() + 1}</span>
    </div>`;
  }).join('')}</div>`;

  const timeColHtml = `<div class="cal-time-col">${hours.map(h =>
    `<div class="cal-time-slot" style="height:${HOUR_H}px">${String(h).padStart(2,'0')}:00</div>`
  ).join('')}</div>`;

  const daysHtml = weekDays.map((d, dayIdx) => {
    const isToday = d.getTime() === today.getTime();
    const cells = hours.map(() => `<div class="cal-hour-cell" style="height:${HOUR_H}px"></div>`).join('');
    const sessionBlocks = byDay[dayIdx].map(s => {
      const h = s.dt.getHours(), m = s.dt.getMinutes();
      if (h < HOUR_START || h >= HOUR_END) return '';
      const top = (h - HOUR_START) * HOUR_H + (m / 60) * HOUR_H;
      const height = Math.max((s.duration_min / 60) * HOUR_H - 4, 28);
      const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const endH = new Date(s.dt.getTime() + s.duration_min * 60000);
      const endStr = `${String(endH.getHours()).padStart(2,'0')}:${String(endH.getMinutes()).padStart(2,'0')}`;
      return `<div class="cal-session ${s.status}" style="top:${top}px;height:${height}px" title="${s.client_name} | ${timeStr}–${endStr}">
        <div class="cal-session-name">${s.client_name}</div>
        ${height > 40 ? `<div class="cal-session-time">${timeStr}–${endStr}</div>` : ''}
      </div>`;
    }).join('');
    let nowLine = '';
    if (isToday) {
      const now = new Date(), nowH = now.getHours(), nowM = now.getMinutes();
      if (nowH >= HOUR_START && nowH < HOUR_END)
        nowLine = `<div class="cal-now-line" style="top:${(nowH - HOUR_START) * HOUR_H + (nowM / 60) * HOUR_H}px"></div>`;
    }
    return `<div class="cal-day-col ${isToday ? 'today' : ''}">${cells}${sessionBlocks}${nowLine}</div>`;
  }).join('');

  $('schedule-content').innerHTML = `<div class="cal-wrapper">${headerHtml}<div class="cal-body">${timeColHtml}<div class="cal-days">${daysHtml}</div></div></div>`;

  const calBody = $('schedule-content').querySelector('.cal-body');
  const now = new Date();
  const scrollHour = scheduleState.weekStart <= now && now <= new Date(scheduleState.weekStart.getTime() + 7 * 24 * 3600000)
    ? Math.max(now.getHours() - 1, HOUR_START) : 7;
  calBody.scrollTop = (scrollHour - HOUR_START) * HOUR_H;
}

$('schedule-trainer-select').addEventListener('change', e => {
  scheduleState.trainerId = e.target.value || null;
  if (scheduleState.trainerId) loadSchedule();
  else {
    $('schedule-content').innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-days" class="empty-icon"></i>
        <h3>בחר מאמן כדי להציג את לוח הזמנים</h3>
      </div>`;
    renderIcons();
  }
});

$('btn-prev-week').addEventListener('click', () => { scheduleState.weekStart.setDate(scheduleState.weekStart.getDate() - 7); updateWeekLabel(); loadSchedule(); });
$('btn-next-week').addEventListener('click', () => { scheduleState.weekStart.setDate(scheduleState.weekStart.getDate() + 7); updateWeekLabel(); loadSchedule(); });
$('btn-today').addEventListener('click', () => { scheduleState.weekStart = getWeekStart(new Date()); updateWeekLabel(); loadSchedule(); });

// ── sidebar mobile toggle ─────────────────────────────────────────────────────
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

$('btn-hamburger').addEventListener('click', openSidebar);
$('sidebar-overlay').addEventListener('click', closeSidebar);

// close sidebar when nav item clicked on mobile
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });
});

// ── init ──────────────────────────────────────────────────────────────────────
$('current-date').textContent = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
api('/trainers').then(t => { state.trainers = t; });
updateWeekLabel();
loadDashboard();
renderIcons();
