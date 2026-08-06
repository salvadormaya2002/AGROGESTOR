// =============================================================================
// AGROGESTOR · Capa de datos + cuentas (db.js)
// -----------------------------------------------------------------------------
// Backend único y compartido (un solo proyecto de Supabase para toda la app).
// Cada usuario se registra con su email/contraseña (Supabase Auth) y sus datos
// quedan aislados: las políticas de la base (RLS) solo dejan ver/editar las
// filas cuyo user_id sea el del usuario logueado. Sin login, la app cae a
// localStorage (modo local, un solo equipo, sin cuenta).
// =============================================================================

const SUPABASE_URL = 'https://atcwajfxemcylfjfvzos.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_w9ZeEI5nXWHxjriFZgaI2g_yoT4yXmK';

const SESSION_KEY = 'agrogestor_session';

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function setSession(s) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
function authHeaders(token) {
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY), 'Content-Type': 'application/json' };
}

// ---- localStorage fallback (sin cuenta) ----
function lsKey(tabla) { return 'agrogestor_tbl_' + tabla; }
function lsList(tabla) { try { return JSON.parse(localStorage.getItem(lsKey(tabla)) || '[]'); } catch (e) { return []; } }
function lsSave(tabla, arr) { try { localStorage.setItem(lsKey(tabla), JSON.stringify(arr)); } catch (e) {} }

function restHeaders() {
  const s = getSession();
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + (s ? s.access_token : SUPABASE_ANON_KEY), 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}
function restUrl(tabla, query) {
  const base = SUPABASE_URL + '/rest/v1/' + tabla;
  return query ? base + '?' + query : base;
}

export const DB = {
  // ===== Cuenta =====
  getSession,
  isLogged() { return !!getSession(); },
  isRemote() { return !!getSession(); },

  async signUp(email, password) {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password }) });
      const data = await r.json();
      if (!r.ok) return { ok: false, msg: data.msg || data.error_description || data.error || 'No se pudo crear la cuenta.' };
      if (data.access_token) { setSession({ access_token: data.access_token, user: data.user }); return { ok: true, msg: 'Cuenta creada.', needsConfirm: false }; }
      return { ok: true, msg: 'Cuenta creada. Revisá tu email para confirmar antes de entrar.', needsConfirm: true };
    } catch (e) { return { ok: false, msg: 'No se pudo conectar.' }; }
  },

  async signIn(email, password) {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password }) });
      const data = await r.json();
      if (!r.ok) return { ok: false, msg: data.error_description || data.msg || 'Email o contraseña incorrectos.' };
      setSession({ access_token: data.access_token, user: data.user });
      return { ok: true, user: data.user };
    } catch (e) { return { ok: false, msg: 'No se pudo conectar.' }; }
  },

  signOut() { setSession(null); },

  // ===== Datos completos de la app (un JSON por cuenta) =====
  async loadUserData() {
    const s = getSession();
    if (!s) return null;
    try {
      const r = await fetch(restUrl('user_data', 'select=data&user_id=eq.' + s.user.id), { headers: restHeaders() });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows[0] ? rows[0].data : null;
    } catch (e) { return null; }
  },
  async saveUserData(data) {
    const s = getSession();
    if (!s) return false;
    try {
      await fetch(restUrl('user_data', 'on_conflict=user_id'), {
        method: 'POST',
        headers: { ...restHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: s.user.id, data, updated_at: new Date().toISOString() }),
      });
      return true;
    } catch (e) { return false; }
  },

  // ===== Datos (por cuenta) =====
  async list(tabla, filtro) {
    const s = getSession();
    if (!s) return lsList(tabla);
    try {
      const q = 'select=*&user_id=eq.' + s.user.id + (filtro ? '&' + filtro : '') + '&order=creado.desc';
      const r = await fetch(restUrl(tabla, q), { headers: restHeaders() });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { return lsList(tabla); }
  },

  async insert(tabla, row) {
    const s = getSession();
    if (!s) {
      const arr = lsList(tabla);
      const nuevo = { ...row, id: row.id || ('l' + Date.now()) };
      arr.unshift(nuevo); lsSave(tabla, arr);
      return nuevo;
    }
    const r = await fetch(restUrl(tabla), { method: 'POST', headers: restHeaders(), body: JSON.stringify({ ...row, user_id: s.user.id }) });
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  async update(tabla, id, patch) {
    const s = getSession();
    if (!s) {
      const arr = lsList(tabla).map(x => x.id === id ? { ...x, ...patch } : x);
      lsSave(tabla, arr);
      return arr.find(x => x.id === id);
    }
    const r = await fetch(restUrl(tabla, 'id=eq.' + encodeURIComponent(id)), { method: 'PATCH', headers: restHeaders(), body: JSON.stringify(patch) });
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  async remove(tabla, id) {
    const s = getSession();
    if (!s) { lsSave(tabla, lsList(tabla).filter(x => x.id !== id)); return true; }
    await fetch(restUrl(tabla, 'id=eq.' + encodeURIComponent(id)), { method: 'DELETE', headers: restHeaders() });
    return true;
  },
};

export default DB;
