"use strict";

// Posibles ubicaciones del catálogo (según se sirva desde web/ o desde la raíz).
const RUTAS_DATOS = ["ayudas.json", "../data/ayudas.json", "data/ayudas.json"];

let TODAS = [];
let CIRC_LABELS = {};
let incluirOtras = false;    // incluir también las no relevantes (cultura, eventos…)

// --- Perfil de situación del usuario ---
const perfilSel = new Set();   // claves de situación marcadas (para emparejar)
const perfilDet = {};          // { clave: { sub:Set } } detalle por situación
let perfilIngresos = "";       // tramo de renta (se guarda; afinará con "IA lee las bases")

// Estructura del perfil basada en cómo clasifican las ayudas (lectura de 141 pliegos).
// La familia se define UNA vez (no se pregunta "a quién" en cada situación).
const GRUPO_FAMILIA = ["familia_numerosa", "monoparental", "hijos", "cuidadores", "acogimiento"];
const GRUPO_SITUACIONES = [
  "discapacidad", "dependencia", "salud", "mujer", "violencia_genero", "desempleo",
  "autonomo", "estudiante", "jovenes", "mayores", "migracion", "vulnerabilidad",
  "orfandad", "terrorismo", "rural",
];
// Subopciones (grado/edad/categoría) con los valores reales vistos en los pliegos.
const SUBOPC = {
  discapacidad: ["33–64 %", "65 % o más", "Movilidad reducida"],
  dependencia: ["Grado I", "Grado II", "Grado III"],
  familia_numerosa: ["General", "Especial"],
  desempleo: ["Larga duración", "Mayor de 45", "Mayor de 52"],
  hijos: ["0–3 años", "3–6", "6–16", "16–25"],
  jovenes: ["16–25", "26–30", "31–35"],
  mayores: ["60–64", "65 o más"],
};
// Tramos de renta de la unidad familiar (medidos en veces el IPREM, como en los pliegos).
const INGRESOS = ["Menos de 1× IPREM", "Entre 1 y 1,5× IPREM", "Entre 1,5 y 2× IPREM", "Más de 2× IPREM"];

const $ = (id) => document.getElementById(id);

// --------------------------------------------------------------------------- //
// Carga
// --------------------------------------------------------------------------- //
async function cargar() {
  for (const ruta of RUTAS_DATOS) {
    try {
      const r = await fetch(ruta, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (_) { /* prueba la siguiente */ }
  }
  throw new Error("No se pudo cargar el catálogo de ayudas.");
}

async function cargarGeo() {
  for (const ruta of ["geo.json", "../web/geo.json"]) {
    try { const r = await fetch(ruta); if (r.ok) return await r.json(); } catch (_) { /* siguiente */ }
  }
  return { provincias: [], municipios: {} };
}

// --------------------------------------------------------------------------- //
// Utilidades de formato
// --------------------------------------------------------------------------- //
function limpiaRegion(txt) {
  // "ES30 - COMUNIDAD DE MADRID" -> "COMUNIDAD DE MADRID"
  if (!txt) return null;
  const m = txt.match(/^ES[0-9]*\s*-\s*(.+)$/i);
  return (m ? m[1] : txt).trim();
}

function territorio(a) {
  // Mejor etiqueta de territorio disponible
  const reg = (a.regiones || []).map(limpiaRegion).filter(Boolean);
  if (reg.length) return reg[0];
  return a.comunidad || null;
}

function capitaliza(t) {
  if (!t) return t;
  return t.length > 60 ? t : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Códigos NUTS2 -> Comunidad Autónoma, para derivar la cascada territorio.
const NUTS2_CCAA = {
  ES11: "Galicia", ES12: "Asturias", ES13: "Cantabria", ES21: "País Vasco",
  ES22: "Navarra", ES23: "La Rioja", ES24: "Aragón", ES30: "Madrid",
  ES41: "Castilla y León", ES42: "Castilla-La Mancha", ES43: "Extremadura",
  ES51: "Cataluña", ES52: "Comunidad Valenciana", ES53: "Illes Balears",
  ES61: "Andalucía", ES62: "Región de Murcia", ES63: "Ceuta", ES64: "Melilla",
  ES70: "Canarias",
};

// Datos oficiales de municipios (INE), cargados desde geo.json.
let GEO = { provincias: [], municipios: {} };
let MUNI_CCAA = {};   // nombre municipio normalizado -> Set de comunidades donde existe
// Normaliza para comparar nombres (minúsculas, sin acentos).
function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

// Índice municipio -> comunidad(es), a partir de los datos del INE.
function construyeMuniIndex() {
  MUNI_CCAA = {};
  const provCCAA = {}; GEO.provincias.forEach((p) => { provCCAA[p.id] = p.ccaa; });
  for (const [pid, lista] of Object.entries(GEO.municipios)) {
    const ccaa = provCCAA[pid];
    lista.forEach((m) => { const k = norm(m); (MUNI_CCAA[k] = MUNI_CCAA[k] || new Set()).add(ccaa); });
  }
}

// Deriva la geografía de una ayuda. Clave: una ayuda LOCAL nunca es estatal;
// su comunidad se deduce de su municipio (su campo "regiones" no es fiable).
function geoDe(a) {
  if (a._geo) return a._geo;
  const partes = (((a.regiones || [])[0]) || "").split(" - ");
  const code = (partes[0] || "").trim();
  let regCCAA = null, estatalReg = false, provincia = null;
  if (code === "ES") estatalReg = true;
  else if (code.length === 4) regCCAA = NUTS2_CCAA[code] || null;
  else if (code.length === 5) { regCCAA = NUTS2_CCAA[code.slice(0, 4)] || null; provincia = (partes[1] || "").trim() || null; }

  const esEstado = a.ambito === "ESTADO";
  const esLocal = a.ambito === "LOCAL";
  const ciudad = esLocal && a.comunidad ? capitaliza(a.comunidad) : null;
  const ciudadN = norm(a.comunidad);

  let ccaaSet;
  if (esEstado) ccaaSet = new Set();
  else if (esLocal) { ccaaSet = new Set(MUNI_CCAA[ciudadN] || []); if (regCCAA) ccaaSet.add(regCCAA); }
  else ccaaSet = new Set(regCCAA ? [regCCAA] : []);

  const estatal = esEstado || (estatalReg && !esLocal);   // LOCAL nunca es estatal
  a._geo = { estatal, ccaaSet, ccaa: [...ccaaSet][0] || null, provincia, ciudad, ciudadN };
  return a._geo;
}

// Convierte títulos EN MAYÚSCULAS a estilo frase, más legibles.
function aSentencia(t) {
  if (!t) return t;
  let s = (t === t.toUpperCase()) ? t.toLowerCase() : t;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.replace(/([.:]\s+)([a-záéíóúüñ])/g, (m, p, c) => p + c.toUpperCase());
}

function fmtImporte(n) {
  if (n == null || isNaN(n)) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmtFecha(f) {
  if (!f) return null;
  const d = new Date(f);
  if (isNaN(d)) return f;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function diasRestantes(f) {
  if (!f) return null;
  const d = new Date(f); if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}

function escapa(t) {
  const div = document.createElement("div");
  div.textContent = t == null ? "" : String(t);
  return div.innerHTML;
}

// Analiza la forma de una URL para etiquetarla con sentido.
function urlInfo(href) {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, "");
    return { bare: path === "", pdf: /\.pdf$/i.test(u.pathname) };
  } catch (_) {
    return { bare: false, pdf: false };
  }
}
function etiquetaBases(href) {
  const i = urlInfo(href);
  if (i.pdf) return "Bases (PDF)";
  if (i.bare) return "Web del organismo";       // solo el dominio, no la ayuda concreta
  return "Ver bases y convocatoria";
}
function etiquetaSede(href) {
  return urlInfo(href).bare ? "Sede electrónica del organismo" : "Ir a la sede para solicitar";
}

// --------------------------------------------------------------------------- //
// Filtros (rellenar selects)
// --------------------------------------------------------------------------- //
function opcionesUnicas(valores) {
  return [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function rellenaSelect(sel, valores) {
  for (const v of valores) {
    const o = document.createElement("option");
    o.value = v; o.textContent = capitaliza(v);
    sel.appendChild(o);
  }
}

function addOptions(sel, items) {
  items.forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
}
function inicializaFiltros() {
  const ccaas = [...new Set(GEO.provincias.map((p) => p.ccaa))].sort((a, b) => a.localeCompare(b, "es"));
  addOptions($("f-ccaa"), ccaas);
  rellenaSelect($("f-finalidad"), opcionesUnicas(TODAS.map((a) => a.finalidad)));
}

// Cascada Comunidad -> Provincia -> Ayuntamiento (datos oficiales del INE).
function actualizaProvincias() {
  const ccaa = $("f-ccaa").value;
  const sel = $("f-provincia");
  sel.innerHTML = '<option value="">Todas</option>';
  $("f-ayuntamiento").value = ""; actualizaMunicipios();
  if (!ccaa) { sel.disabled = true; return; }
  addOptions(sel, GEO.provincias.filter((p) => p.ccaa === ccaa).map((p) => p.nombre).sort((a, b) => a.localeCompare(b, "es")));
  sel.disabled = false;
}
function actualizaMunicipios() {
  const dl = $("lista-municipios"); if (dl) dl.innerHTML = "";
  const prov = GEO.provincias.find((p) => p.nombre === $("f-provincia").value);
  if (!prov || !dl) return;
  (GEO.municipios[prov.id] || []).forEach((m) => { const o = document.createElement("option"); o.value = m; dl.appendChild(o); });
}

// --------------------------------------------------------------------------- //
// Render
// --------------------------------------------------------------------------- //
function tarjeta(a) {
  const li = document.createElement("li");
  li.className = "tarjeta";

  const badges = [];
  if (a.ambito) badges.push(`<span class="badge ambito">${escapa(capitaliza(a.ambito))}</span>`);
  const g = geoDe(a);
  const terr = g.ciudad || g.ccaa || (g.estatal ? "España" : null);
  if (terr) badges.push(`<span class="badge">${escapa(terr)}</span>`);
  if (a.finalidad) badges.push(`<span class="badge">${escapa(a.finalidad)}</span>`);
  const dias = diasRestantes(a.fecha_fin);
  if (dias != null && dias >= 0) {
    const txt = dias === 0 ? "Cierra hoy" : `Cierra en ${dias} día${dias === 1 ? "" : "s"}`;
    badges.push(`<span class="badge plazo">${txt}</span>`);
  }

  const meta = [];
  if (a.organo) meta.push(`<span><b>Convoca:</b> ${escapa(a.organo)}</span>`);
  const imp = fmtImporte(a.importe_total);
  if (imp) meta.push(`<span><b>Dotación:</b> ${escapa(imp)}</span>`);
  const ff = fmtFecha(a.fecha_fin);
  if (ff) meta.push(`<span><b>Plazo hasta:</b> ${escapa(ff)}</span>`);

  // Enlaces, en orden de utilidad: sede (solicitar) > bases > ficha BDNS.
  // Se ocultan los marcados como "muerto"; la ficha de BDNS queda de red de seguridad.
  const posibles = [];
  if (a.sede_electronica && a.sede_estado !== "muerto")
    posibles.push([a.sede_electronica, etiquetaSede(a.sede_electronica)]);
  if (a.url_bases && a.bases_estado !== "muerto")
    posibles.push([a.url_bases, etiquetaBases(a.url_bases)]);
  if (a.url_ficha) posibles.push([a.url_ficha, "Ficha en BDNS"]);
  const enlaces = posibles.map(([href, txt], i) =>
    `<a class="${i === 0 ? "principal" : "secundario"}" href="${escapa(href)}" target="_blank" rel="noopener">${escapa(txt)}</a>`);

  li.innerHTML = `
    <div class="badges">${badges.join("")}</div>
    <h2>${escapa(aSentencia(a.titulo))}</h2>
    <p class="meta">${meta.join("")}</p>
    <div class="enlaces">${enlaces.join("")}</div>
  `;
  return li;
}

function aplica() {
  const q = $("busqueda").value.trim().toLowerCase();
  const ccaa = $("f-ccaa").value;
  const ayto = norm($("f-ayuntamiento").value);
  const fin = $("f-finalidad").value;

  const filtradas = TODAS.filter((a) => {
    // Cascada territorio: si das tu comunidad ves las estatales + las de tu
    // comunidad. Si das tu ayuntamiento, de lo LOCAL solo el tuyo (nunca otro).
    if (ccaa) {
      const g = geoDe(a);
      if (!g.estatal) {
        if (!g.ccaaSet.has(ccaa)) return false;
        if (ayto && g.ciudad && g.ciudadN !== ayto) return false;
      }
    }
    if (fin && a.finalidad !== fin) return false;
    // Circunstancias: si hay marcadas, debe casar al menos una.
    if (perfilSel.size) {
      const cs = a.circunstancias || [];
      let casa = false;
      for (const c of perfilSel) if (cs.includes(c)) { casa = true; break; }
      if (!casa) return false;
    } else if (!incluirOtras && a.relevancia_familiar === false) {
      // Sin circunstancias marcadas: por defecto solo bienestar familiar.
      return false;
    }
    if (q) {
      const texto = [a.titulo, a.organo, a.finalidad, a.comunidad, (a.regiones || []).join(" ")]
        .join(" ").toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const ul = $("resultados");
  ul.innerHTML = "";
  filtradas.forEach((a) => ul.appendChild(tarjeta(a)));
  const n = filtradas.length;
  let cola;
  if (perfilSel.size) cola = n === 1 ? " que puede corresponderte" : " que pueden corresponderte";
  else if (!incluirOtras) cola = " para personas y familias";
  else cola = " abiertas";
  $("resumen").textContent = `${n} ayuda${n === 1 ? "" : "s"}` + cola;
  $("vacio").hidden = n !== 0;
}

// --------------------------------------------------------------------------- //
// "Tu situación" en bloques (familia · economía · situaciones)
// --------------------------------------------------------------------------- //
// Panel de detalle (solo subopciones: grado, edad, categoría) de una situación.
function panelDetalle(c) {
  const det = perfilDet[c] || (perfilDet[c] = { sub: new Set() });
  if (!det.sub) det.sub = new Set();
  const wrap = document.createElement("div");
  wrap.className = "sit-panel"; wrap.dataset.sit = c;
  wrap.innerHTML = `<span class="sit-panel-titulo">${escapa(CIRC_LABELS[c])}</span>`;
  const f = document.createElement("div"); f.className = "sub-fila";
  f.innerHTML = '<span class="sub-label">Detalle:</span>';
  SUBOPC[c].forEach((o) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "minichip"; b.textContent = o;
    b.setAttribute("aria-pressed", det.sub.has(o) ? "true" : "false");
    b.addEventListener("click", () => {
      det.sub.has(o) ? det.sub.delete(o) : det.sub.add(o);
      b.setAttribute("aria-pressed", det.sub.has(o) ? "true" : "false");
    });
    f.appendChild(b);
  });
  wrap.appendChild(f);
  return wrap;
}

// Bloque de situaciones seleccionables (familia o situaciones personales).
function bloqueSituaciones(titulo, claves) {
  const bloque = document.createElement("div");
  bloque.className = "bloque";
  bloque.innerHTML = `<h3>${escapa(titulo)}</h3>`;
  const chips = document.createElement("div"); chips.className = "chips";
  const paneles = document.createElement("div"); paneles.className = "grupo-paneles";
  claves.forEach((c) => {
    if (!CIRC_LABELS[c]) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.sit = c;
    b.textContent = CIRC_LABELS[c];
    b.setAttribute("aria-pressed", perfilSel.has(c) ? "true" : "false");
    if (perfilSel.has(c) && SUBOPC[c]) paneles.appendChild(panelDetalle(c));
    b.addEventListener("click", () => {
      if (perfilSel.has(c)) {
        perfilSel.delete(c); delete perfilDet[c];
        b.setAttribute("aria-pressed", "false");
        const p = paneles.querySelector(`.sit-panel[data-sit="${c}"]`);
        if (p) p.remove();
      } else {
        perfilSel.add(c);
        b.setAttribute("aria-pressed", "true");
        if (SUBOPC[c]) paneles.appendChild(panelDetalle(c));
      }
      // No se busca aquí: la búsqueda se lanza con el botón "Buscar".
    });
    chips.appendChild(b);
  });
  bloque.appendChild(chips); bloque.appendChild(paneles);
  return bloque;
}

// Bloque de ingresos (selección única de tramo). Se guarda en el perfil; aún no
// filtra (las ayudas de BDNS no traen el umbral; llegará con "IA lee las bases").
function bloqueIngresos() {
  const bloque = document.createElement("div");
  bloque.className = "bloque";
  bloque.innerHTML = `<h3>¿Cuál es vuestra situación económica?</h3>`;
  const chips = document.createElement("div"); chips.className = "chips";
  INGRESOS.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = opt;
    b.setAttribute("aria-pressed", perfilIngresos === opt ? "true" : "false");
    b.addEventListener("click", () => {
      perfilIngresos = perfilIngresos === opt ? "" : opt;
      chips.querySelectorAll(".chip").forEach((x) =>
        x.setAttribute("aria-pressed", x.textContent === perfilIngresos ? "true" : "false"));
    });
    chips.appendChild(b);
  });
  bloque.appendChild(chips);
  const nota = document.createElement("p");
  nota.className = "situacion-sub";
  nota.textContent = "Se guarda en tu perfil; afinará los resultados cuando leamos las bases con detalle.";
  bloque.appendChild(nota);
  return bloque;
}

function construyeBloques() {
  const cont = $("bloques");
  if (!cont) return;
  cont.innerHTML = "";
  cont.appendChild(bloqueSituaciones("¿Quiénes formáis la familia?", GRUPO_FAMILIA));
  cont.appendChild(bloqueIngresos());
  cont.appendChild(bloqueSituaciones("¿Alguien está en alguna de estas situaciones?", GRUPO_SITUACIONES));
}

// --- Varios perfiles guardados en el navegador (sin servidor) ---
const PERF_KEY = "radar_perfiles";
function avisoPerfil(m) {
  const e = $("perfil-aviso");
  if (e) { e.textContent = m; setTimeout(() => { e.textContent = ""; }, 3000); }
}
function leePerfiles() {
  try { return JSON.parse(localStorage.getItem(PERF_KEY)) || { activo: "", perfiles: {} }; }
  catch (_) { return { activo: "", perfiles: {} }; }
}
function escribePerfiles(o) { try { localStorage.setItem(PERF_KEY, JSON.stringify(o)); } catch (_) {} }

// Vuelca el estado actual de la UI a un objeto perfil.
function estadoActual() {
  const det = {};
  for (const k of perfilSel) det[k] = { sub: [...((perfilDet[k] || {}).sub || [])] };
  return {
    sel: [...perfilSel], det, ingresos: perfilIngresos, incluirOtras,
    ccaa: $("f-ccaa").value, provincia: $("f-provincia").value, ayto: $("f-ayuntamiento").value,
    tema: $("f-finalidad").value, q: $("busqueda").value,
  };
}
// Carga un objeto perfil en la UI (selecciones, ingresos, ubicación, tema).
function aplicaEstado(p) {
  p = p || {};
  perfilSel.clear();
  Object.keys(perfilDet).forEach((k) => delete perfilDet[k]);
  (p.sel || []).forEach((k) => {
    perfilSel.add(k);
    perfilDet[k] = { sub: new Set((p.det && p.det[k] ? p.det[k].sub : []) || []) };
  });
  perfilIngresos = p.ingresos || "";
  incluirOtras = !!p.incluirOtras;
  const chk = $("incluir-otras"); if (chk) chk.checked = incluirOtras;
  $("f-ccaa").value = p.ccaa || ""; actualizaProvincias();
  $("f-provincia").value = p.provincia || ""; actualizaMunicipios();
  $("f-ayuntamiento").value = p.ayto || "";
  $("f-finalidad").value = p.tema || "";
  $("busqueda").value = p.q || "";
  construyeBloques();
}
function refrescaSelector() {
  const o = leePerfiles(); const sel = $("perfil-select"); if (!sel) return;
  sel.innerHTML = '<option value="">— nuevo perfil —</option>';
  Object.keys(o.perfiles).forEach((n) => {
    const op = document.createElement("option"); op.value = n; op.textContent = n; sel.appendChild(op);
  });
  sel.value = o.activo || "";
}
function guardaPerfil() {
  const nombre = ($("perfil-nombre").value || $("perfil-select").value || "Mi perfil").trim();
  const o = leePerfiles();
  o.perfiles[nombre] = estadoActual(); o.activo = nombre;
  escribePerfiles(o); refrescaSelector();
  avisoPerfil(`Guardado como "${nombre}" ✓`);
}
function borraPerfil() {
  const o = leePerfiles(); const n = $("perfil-select").value;
  if (n && o.perfiles[n]) { delete o.perfiles[n]; o.activo = ""; escribePerfiles(o); }
  aplicaEstado({}); $("perfil-nombre").value = ""; refrescaSelector();
  avisoPerfil(n ? `Perfil "${n}" borrado` : "Perfil limpiado");
}
function cambiaPerfil() {
  const n = $("perfil-select").value; const o = leePerfiles();
  if (n && o.perfiles[n]) { aplicaEstado(o.perfiles[n]); $("perfil-nombre").value = n; o.activo = n; }
  else { aplicaEstado({}); $("perfil-nombre").value = ""; o.activo = ""; }
  escribePerfiles(o);
  aplica();   // al cambiar de perfil sí mostramos sus resultados
}

// --------------------------------------------------------------------------- //
// Arranque
// --------------------------------------------------------------------------- //
async function init() {
  try {
    const datos = await cargar();
    TODAS = datos.ayudas || [];
    CIRC_LABELS = datos.circunstancias_catalogo || {};
    GEO = await cargarGeo();
    construyeMuniIndex();
    inicializaFiltros();
    refrescaSelector();
    const _o = leePerfiles();
    if (_o.activo && _o.perfiles[_o.activo]) {
      aplicaEstado(_o.perfiles[_o.activo]);
      $("perfil-nombre").value = _o.activo;
    } else {
      actualizaProvincias();
      construyeBloques();
    }
    aplica();
    if (datos.generado) {
      const f = new Date(datos.generado);
      $("actualizado").textContent = "Catálogo actualizado el " +
        f.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }) +
        ` · ${TODAS.length} ayudas abiertas`;
    }
  } catch (e) {
    $("resumen").textContent = "No se pudo cargar el catálogo. Inténtalo de nuevo más tarde.";
    console.error(e);
  }

  // Los desplegables filtran al instante; la búsqueda por texto se ejecuta
  // al pulsar "Buscar" o Enter.
  // La búsqueda NO es automática: solo se ejecuta al pulsar "Buscar" o Enter.
  // Los demás controles solo actualizan su estado (sin relanzar la búsqueda).
  $("f-ccaa").addEventListener("change", actualizaProvincias);
  $("f-provincia").addEventListener("change", actualizaMunicipios);
  $("buscar").addEventListener("click", aplica);
  $("busqueda").addEventListener("keydown", (e) => { if (e.key === "Enter") aplica(); });
  const chkOtras = $("incluir-otras");
  if (chkOtras) {
    chkOtras.checked = incluirOtras;
    chkOtras.addEventListener("change", () => { incluirOtras = chkOtras.checked; });
  }
  const selP = $("perfil-select"); if (selP) selP.addEventListener("change", cambiaPerfil);
  const bG = $("guardar-perfil"); if (bG) bG.addEventListener("click", guardaPerfil);
  const bB = $("borrar-perfil"); if (bB) bB.addEventListener("click", borraPerfil);
}

init();
