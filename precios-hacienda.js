// =============================================================================
// AGROGESTOR · Proxy de precios de hacienda  (Vercel Serverless Function)
// -----------------------------------------------------------------------------
// El navegador NO puede leer el Mercado Agroganadero directo (lo bloquea CORS).
// Esta función corre en el SERVIDOR (sin restricción de CORS), lee la fuente,
// la parsea y le devuelve a AGROGESTOR un JSON limpio con cabeceras CORS
// habilitadas para que la app del cliente sí pueda consumirlo.
//
// Deploy: dejá este archivo en /api/precios-hacienda.js de tu proyecto Vercel.
// Quedará disponible en  https://TU-DOMINIO/api/precios-hacienda
//
// IMPORTANTE: revisá vercel.json para que /api/* NO sea capturado por el
// catch-all de la SPA (ver PROXY-README.md).
// =============================================================================

// Fuente primaria. El MAG publica la síntesis diaria en esta ruta (HTML).
const SOURCE_URL = 'https://www.mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000001';

// Valores de referencia (junio 2026) — se usan si la fuente no responde o no
// se puede parsear. Mantenelos actualizados como red de seguridad.
const REFERENCIA = [
  { id: 'ternero',     label: 'Ternero',        precio: 6850, peso: 170 },
  { id: 'ternera',     label: 'Ternera',        precio: 6500, peso: 160 },
  { id: 'mej',         label: 'MEJ',            precio: 6300, peso: 340 },
  { id: 'novillito',   label: 'Novillito',      precio: 6200, peso: 300 },
  { id: 'novillo_liv', label: 'Novillo liviano', precio: 5900, peso: 410 },
  { id: 'novillo_pes', label: 'Novillo pesado',  precio: 5600, peso: 490 },
  { id: 'vaquillona',  label: 'Vaquillona',     precio: 6050, peso: 330 },
  { id: 'vaca_buena',  label: 'Vaca buena',     precio: 4600, peso: 420 },
  { id: 'vaca',        label: 'Vaca (refugo)',  precio: 4000, peso: 430 },
  { id: 'conserva',    label: 'Conserva',       precio: 3400, peso: 400 },
  { id: 'toro',        label: 'Toro',           precio: 3550, peso: 650 },
  { id: 'buey',        label: 'Buey',           precio: 3300, peso: 700 },
];

// Mapa categoría -> palabra clave + peso de referencia.
const CATS = [
  { id: 'ternero',     label: 'Ternero',        kw: /\bterneros?\b/i,     peso: 170 },
  { id: 'ternera',     label: 'Ternera',        kw: /\bterneras?\b/i,     peso: 160 },
  { id: 'mej',         label: 'MEJ',            kw: /\bm\.?e\.?j\.?\b/i, peso: 340 },
  { id: 'novillito',   label: 'Novillito',      kw: /\bnovillitos?\b/i,   peso: 300 },
  { id: 'novillo_liv', label: 'Novillo liviano', kw: /novillos?\s*livianos?/i, peso: 410 },
  { id: 'novillo_pes', label: 'Novillo pesado',  kw: /novillos?\s*pesados?/i,  peso: 490 },
  { id: 'vaquillona',  label: 'Vaquillona',     kw: /\bvaquillonas?\b/i,  peso: 330 },
  { id: 'vaca_buena',  label: 'Vaca buena',     kw: /vacas?\s*buenas?/i,   peso: 420 },
  { id: 'conserva',    label: 'Conserva',       kw: /\bconservas?\b/i,    peso: 400 },
  { id: 'vaca',        label: 'Vaca (refugo)',  kw: /\bvacas?\b/i,        peso: 430 },
  { id: 'toro',        label: 'Toro',           kw: /\btoros?\b/i,        peso: 650 },
  { id: 'buey',        label: 'Buey',           kw: /\bbueyes?\b/i,       peso: 700 },
];

// "1.234,56" (es-AR) -> 1234.56
function parseNum(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

// Heurística: pasa el HTML a texto plano y, para cada categoría, busca la
// palabra clave y toma el primer valor numérico "de precio" (> 500) cercano.
// >>> Es un punto de arranque. Ajustá los selectores/regex al HTML real de tu
//     fuente (inspeccioná la página y mapeá las filas de la tabla por categoría).
function parsearHacienda(html) {
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  const out = [];
  for (const c of CATS) {
    const m = c.kw.exec(texto);
    if (!m) continue;
    // ventana de 120 caracteres tras la palabra clave
    const ventana = texto.slice(m.index, m.index + 120);
    // primer número con formato de precio (admite miles y decimales)
    const precios = (ventana.match(/\d{1,3}(?:\.\d{3})*(?:,\d+)?/g) || [])
      .map(parseNum)
      .filter((n) => n > 500); // descartá pesos/cabezas chicos
    if (precios.length) {
      out.push({ id: c.id, label: c.label, precio: Math.round(precios[0]), peso: c.peso });
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  // CORS: permití que la app (en cualquier origen) consuma este endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache en el edge: 1 h fresco, hasta 24 h sirviendo viejo mientras revalida.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(SOURCE_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (AGROGESTOR price proxy)' },
    });
    clearTimeout(t);
    const html = await r.text();
    const categorias = parsearHacienda(html);

    if (categorias.length >= 3) {
      res.status(200).json({
        source: 'live',
        origen: 'Mercado Agroganadero de Cañuelas',
        actualizado: new Date().toISOString(),
        categorias,
      });
      return;
    }
    throw new Error('No se pudieron parsear suficientes categorías (' + categorias.length + ').');
  } catch (err) {
    // Fallback honesto: devolvemos referencia con source:"ref" para que la app
    // muestre el estado correcto en vez de datos inventados.
    res.status(200).json({
      source: 'ref',
      origen: 'valores de referencia',
      actualizado: new Date().toISOString(),
      error: String((err && err.message) || err),
      categorias: REFERENCIA,
    });
  }
};
