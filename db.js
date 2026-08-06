// =============================================================================
// AGROGESTOR · Capa de datos (db.js)
// -----------------------------------------------------------------------------
// Una sola API para toda la app. Si hay credenciales de Supabase configuradas,
// guarda y lee de la BASE DE DATOS EN LA NUBE (compartida entre el productor y
// el peón, en tiempo real). Si no, cae automáticamente a localStorage para que
// la app siga funcionando sin conexión / sin configurar.
//
// Supabase = PostgreSQL gestionado, gratis, con API REST y CORS. La app lo llama
// directo desde el navegador con la "anon key" (clave pública de solo-lectura/
// escritura acotada por reglas RLS). No expone la base al público: las reglas se
// definen en el panel de Supabase (ver SUPABASE-README.md).
// =============================================================================

const CONFIG_KEY = 'agrogestor_db_config';

function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); } catch (e) { return null; }
}
function setConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
}
function isRemote() {
  const c = getConfig();
  return !!(c && c.url && c.key);
}

function headers() {
  const c = getConfig();
  return {
    'apikey': c.key,
    'Authorization': 'Bearer ' + c.key,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}
function restUrl(tabla, query) {
  const c = getConfig();
  const base = c.url.replace(/\/$/, '') + '/rest/v1/' + tabla;
  return query ? base + '?' + query : base;
}

// ---- localStorage fallback ----
function lsKey(tabla) { return 'agrogestor_tbl_' + tabla; }
function lsList(tabla) {
  try { return JSON.parse(localStorage.getItem(lsKey(tabla)) || '[]'); } catch (e) { return []; }
}
function lsSave(tabla, arr) {
  try { localStorage.setItem(lsKey(tabla), JSON.stringify(arr)); } catch (e) {}
}

// ---- API pública ----
export const DB = {
  getConfig,
  setConfig,
  clearConfig() { try { localStorage.removeItem(CONFIG_KEY); } catch (e) {} },
  isRemote,

  // Prueba la conexión: pide 1 fila de la tabla "campos". Devuelve {ok, msg}.
  async test(url, key) {
    try {
      const u = url.replace(/\/$/, '') + '/rest/v1/campos?select=id&limit=1';
      const r = await fetch(u, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (r.ok) return { ok: true, msg: 'Conexión exitosa' };
      if (r.status === 401 || r.status === 403) return { ok: false, msg: 'Clave incorrecta o permisos (RLS) sin configurar.' };
      if (r.status === 404) return { ok: false, msg: 'Falta crear las tablas. Corré el SQL del README.' };
      return { ok: false, msg: 'Error ' + r.status };
    } catch (e) {
      return { ok: false, msg: 'No se pudo conectar. Revisá la URL.' };
    }
  },

  // Lista todas las filas de una tabla (opcional: filtro tipo "peon=eq.Ramón").
  async list(tabla, filtro) {
    if (!isRemote()) return lsList(tabla);
    try {
      const q = 'select=*' + (filtro ? '&' + filtro : '') + '&order=creado.desc';
      const r = await fetch(restUrl(tabla, q), { headers: headers() });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      return lsList(tabla); // fallback si falla la red
    }
  },

  // Inserta una fila. Devuelve la fila creada.
  async insert(tabla, row) {
    if (!isRemote()) {
      const arr = lsList(tabla);
      const nuevo = { ...row, id: row.id || ('l' + Date.now()) };
      arr.unshift(nuevo); lsSave(tabla, arr);
      return nuevo;
    }
    const r = await fetch(restUrl(tabla), { method: 'POST', headers: headers(), body: JSON.stringify(row) });
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  // Actualiza por id.
  async update(tabla, id, patch) {
    if (!isRemote()) {
      const arr = lsList(tabla).map(x => x.id === id ? { ...x, ...patch } : x);
      lsSave(tabla, arr);
      return arr.find(x => x.id === id);
    }
    const r = await fetch(restUrl(tabla, 'id=eq.' + encodeURIComponent(id)), {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    const data = await r.json();
    return Array.isArray(data) ? data[0] : data;
  },

  // Elimina por id.
  async remove(tabla, id) {
    if (!isRemote()) {
      lsSave(tabla, lsList(tabla).filter(x => x.id !== id));
      return true;
    }
    await fetch(restUrl(tabla, 'id=eq.' + encodeURIComponent(id)), { method: 'DELETE', headers: headers() });
    return true;
  },
};

export default DB;
