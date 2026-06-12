"use strict";

// Posibles ubicaciones del catálogo (según se sirva desde web/ o desde la raíz).
const RUTAS_DATOS = ["ayudas.json", "../data/ayudas.json", "data/ayudas.json"];

let TODAS = [];
let CIRC_LABELS = {};
let incluirOtras = false;    // incluir también las no relevantes (cultura, eventos…)

// --- Perfil del hogar (modelo acordado: hogar + una ficha por miembro) ---
// La familia se define UNA vez; la edad sale del año de nacimiento de cada miembro.
function hogarVacio() {
  return { tipo: "", numerosaCat: "", acogimiento: false, numMiembros: 1, ingresos: "", empleados: 0 };
}
function miembroVacio() { return { anio: "", sits: {} }; }  // sits: { clave: [subopciones] }
let HOGAR = hogarVacio();
let MIEMBROS = [miembroVacio()];

// Situaciones por miembro (etiquetas claras, valores reales de los pliegos).
const SITS_MIEMBRO = [
  ["discapacidad", "Discapacidad"],
  ["dependencia", "Dependencia"],
  ["salud", "Enfermedad grave"],
  ["estudiante", "Estudiante"],
  ["desempleo", "En paro"],
  ["autonomo", "Autónomo/a"],
  ["mujer", "Mujer"],
  ["violencia_genero", "Víctima de violencia de género"],
  ["migracion", "Migrante o retornado/a"],
  ["orfandad", "Orfandad o viudedad"],
  ["terrorismo", "Víctima de terrorismo"],
];
const SUBOPC = {
  discapacidad: ["33–64 %", "65 % o más", "Movilidad reducida"],
  dependencia: ["Grado I", "Grado II", "Grado III"],
  desempleo: ["Larga duración"],
};
// Tramos de renta de la unidad familiar (en veces el IPREM, como en los pliegos).
const INGRESOS = ["Menos de 1× IPREM", "Entre 1 y 1,5× IPREM", "Entre 1,5 y 2× IPREM", "Más de 2× IPREM"];

function edadDe(anio) {
  const y = parseInt(anio, 10);
  if (!y || y < 1900 || y > new Date().getFullYear()) return null;
  return new Date().getFullYear() - y;
}

// Claves de circunstancia que el perfil implica (para el primer filtro, generoso).
// Mezcla lo declarado (situaciones por miembro, tipo de familia) con lo derivado
// (edades -> hijos/joven/mayor; ingresos bajos -> vulnerabilidad).
function clavesPerfil() {
  const s = new Set();
  if (HOGAR.tipo === "numerosa") s.add("familia_numerosa");
  if (HOGAR.tipo === "monoparental") s.add("monoparental");
  if (HOGAR.acogimiento) s.add("acogimiento");
  if (HOGAR.ingresos === INGRESOS[0]) s.add("vulnerabilidad");
  const edades = MIEMBROS.map((m) => edadDe(m.anio)).filter((e) => e != null);
  MIEMBROS.forEach((m) => {
    Object.keys(m.sits).forEach((k) => s.add(k));
    const e = edadDe(m.anio);
    if (e == null) return;
    if (e < 18) s.add("hijos");
    else if (e <= 25 && edades.some((o) => o >= e + 16)) s.add("hijos");  // joven con padre/madre plausible
    if (e >= 16 && e <= 35) s.add("jovenes");
    if (e >= 60) s.add("mayores");
  });
  return s;
}

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
  construyeAliasGeo();
}

// Alias territoriales (nombres de CCAA, variantes cooficiales y provincias) para
// localizar organismos por su nombre ("UNIVERSIDAD DE ALICANTE" -> C. Valenciana).
let GEO_ALIAS = [];   // [textoNormalizado, ccaa] ordenado de más largo a más corto
function construyeAliasGeo() {
  const pares = [];
  const ccaas = [...new Set(GEO.provincias.map((p) => p.ccaa))];
  ccaas.forEach((c) => pares.push([norm(c), c]));
  // Variantes cooficiales / habituales que no salen de los datos del INE
  const extra = {
    "catalunya": "Cataluña", "euskadi": "País Vasco", "comunitat valenciana": "Comunidad Valenciana",
    "comunidad de madrid": "Madrid", "comunidad foral de navarra": "Navarra", "nafarroa": "Navarra",
    "principado de asturias": "Asturias", "galiza": "Galicia", "balears": "Illes Balears",
  };
  Object.entries(extra).forEach(([k, v]) => pares.push([k, v]));
  GEO.provincias.forEach((p) => {
    p.nombre.split("/").forEach((variante) => {
      const v = norm(variante);
      if (v.length >= 4) pares.push([v, p.ccaa]);   // evita alias demasiado cortos
    });
  });
  GEO_ALIAS = pares.sort((a, b) => b[0].length - a[0].length);
}
// Devuelve la CCAA que el nombre de un organismo deja entrever, o null.
function ccaaPorNombre(nombreOrganismo) {
  const t = norm(nombreOrganismo);
  if (!t) return null;
  for (const [alias, ccaa] of GEO_ALIAS) if (t.includes(alias)) return ccaa;
  return null;
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

  let ccaaSet, estatal;
  if (esEstado) {
    ccaaSet = new Set(); estatal = true;
  } else if (esLocal) {
    // Una ayuda local NUNCA es estatal: su comunidad sale de su municipio (INE).
    ccaaSet = new Set(MUNI_CCAA[ciudadN] || []); if (regCCAA) ccaaSet.add(regCCAA);
    estatal = false;
  } else if (a.ambito === "AUTONOMICA") {
    // Una autonómica NUNCA es estatal: su comunidad es su propio nivel2
    // (su campo "regiones" a veces dice "ES - ESPAÑA" y no es fiable).
    const porNombre = ccaaPorNombre(a.comunidad);
    ccaaSet = new Set([porNombre || regCCAA].filter(Boolean));
    estatal = false;
  } else {
    // OTROS (universidades, fundaciones...): localiza el organismo por su nombre;
    // solo cuenta como estatal si es genuinamente nacional (no localizable).
    const porNombre = ccaaPorNombre(a.comunidad) || ccaaPorNombre(a.organo);
    if (porNombre) { ccaaSet = new Set([porNombre]); estatal = false; }
    else if (regCCAA) { ccaaSet = new Set([regCCAA]); estatal = false; }
    else { ccaaSet = new Set(); estatal = estatalReg; }
  }

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
  const claves = clavesPerfil();

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
    // Circunstancias del hogar (declaradas + derivadas): debe casar al menos una.
    if (claves.size) {
      const cs = a.circunstancias || [];
      let casa = false;
      for (const c of claves) if (cs.includes(c)) { casa = true; break; }
      if (!casa) return false;
    } else if (!incluirOtras && a.relevancia_familiar === false) {
      // Sin perfil rellenado: por defecto solo bienestar familiar.
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
  if (claves.size) cola = n === 1 ? " que puede corresponderos" : " que pueden corresponderos";
  else if (!incluirOtras) cola = " para personas y familias";
  else cola = " abiertas";
  $("resumen").textContent = `${n} ayuda${n === 1 ? "" : "s"}` + cola;
  $("vacio").hidden = n !== 0;
}

// --------------------------------------------------------------------------- //
// "Vuestra familia": bloque de hogar + una ficha por miembro
// --------------------------------------------------------------------------- //
function chipBtn(txt, on, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = txt;
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.addEventListener("click", onClick);
  return b;
}
function miniBtn(txt, on, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "minichip"; b.textContent = txt;
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.addEventListener("click", onClick);
  return b;
}
function filaCampo(etiqueta) {
  const f = document.createElement("div"); f.className = "sub-fila";
  const s = document.createElement("span"); s.className = "sub-label"; s.textContent = etiqueta;
  f.appendChild(s);
  return f;
}

// Bloque 1: el hogar (tipo de familia, acogimiento, nº de miembros, ingresos, empleados).
function bloqueHogar() {
  const bloque = document.createElement("div");
  bloque.className = "bloque";
  bloque.innerHTML = "<h3>Vuestro hogar</h3>";

  // Tipo de familia (selección única)
  const fTipo = filaCampo("Tipo de familia:");
  [["", "Normal"], ["numerosa", "Numerosa"], ["monoparental", "Monoparental"]].forEach(([val, txt]) => {
    fTipo.appendChild(miniBtn(txt, HOGAR.tipo === val, () => {
      HOGAR.tipo = val; if (val !== "numerosa") HOGAR.numerosaCat = "";
      construyeBloques();
    }));
  });
  bloque.appendChild(fTipo);
  if (HOGAR.tipo === "numerosa") {
    const fCat = filaCampo("Categoría:");
    ["General", "Especial"].forEach((c) => {
      fCat.appendChild(miniBtn(c, HOGAR.numerosaCat === c, () => {
        HOGAR.numerosaCat = HOGAR.numerosaCat === c ? "" : c; construyeBloques();
      }));
    });
    bloque.appendChild(fCat);
  }

  // Acogimiento / tutela
  const fAco = filaCampo("¿Acogimiento o tutela de un menor?");
  fAco.appendChild(miniBtn("Sí", HOGAR.acogimiento, () => { HOGAR.acogimiento = !HOGAR.acogimiento; construyeBloques(); }));
  bloque.appendChild(fAco);

  // Nº de miembros -> genera las fichas
  const fNum = filaCampo("¿Cuántos sois en casa?");
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "1"; inp.max = "15"; inp.value = HOGAR.numMiembros; inp.className = "num-input";
  inp.addEventListener("change", () => {
    const n = Math.max(1, Math.min(15, parseInt(inp.value, 10) || 1));
    HOGAR.numMiembros = n;
    while (MIEMBROS.length < n) MIEMBROS.push(miembroVacio());
    MIEMBROS.length = n;
    construyeBloques();
  });
  fNum.appendChild(inp);
  bloque.appendChild(fNum);

  // Ingresos de la unidad familiar (selección única)
  const fIng = filaCampo("Ingresos del hogar:");
  INGRESOS.forEach((opt) => {
    fIng.appendChild(miniBtn(opt, HOGAR.ingresos === opt, () => {
      HOGAR.ingresos = HOGAR.ingresos === opt ? "" : opt; construyeBloques();
    }));
  });
  bloque.appendChild(fIng);

  // Empleados del hogar (se captura; sus fichas llegarán tras leer ayudas reales)
  const fEmp = filaCampo("¿Tenéis empleados del hogar?");
  fEmp.appendChild(miniBtn("Sí", HOGAR.empleados > 0, () => {
    HOGAR.empleados = HOGAR.empleados > 0 ? 0 : 1; construyeBloques();
  }));
  if (HOGAR.empleados > 0) {
    const ie = document.createElement("input");
    ie.type = "number"; ie.min = "1"; ie.max = "9"; ie.value = HOGAR.empleados; ie.className = "num-input";
    ie.addEventListener("change", () => { HOGAR.empleados = Math.max(1, Math.min(9, parseInt(ie.value, 10) || 1)); });
    const lbl = document.createElement("span"); lbl.className = "sub-label"; lbl.textContent = "¿Cuántos?";
    fEmp.appendChild(lbl); fEmp.appendChild(ie);
  }
  bloque.appendChild(fEmp);
  return bloque;
}

// Ficha de un miembro: año de nacimiento + sus situaciones (con detalle).
function fichaMiembro(i) {
  const m = MIEMBROS[i];
  const ficha = document.createElement("div");
  ficha.className = "sit-panel ficha-miembro"; ficha.dataset.miembro = i;

  const cab = document.createElement("div"); cab.className = "sub-fila";
  const tit = document.createElement("span"); tit.className = "sit-panel-titulo"; tit.textContent = `Miembro ${i + 1}`;
  const lblA = document.createElement("span"); lblA.className = "sub-label"; lblA.textContent = "Año de nacimiento:";
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "1900"; inp.max = String(new Date().getFullYear());
  inp.placeholder = "p. ej. 1980"; inp.value = m.anio || ""; inp.className = "num-input anio";
  inp.addEventListener("change", () => { m.anio = inp.value; });
  cab.appendChild(tit); cab.appendChild(lblA); cab.appendChild(inp);
  ficha.appendChild(cab);

  const fS = filaCampo("Situaciones:");
  SITS_MIEMBRO.forEach(([clave, txt]) => {
    fS.appendChild(miniBtn(txt, clave in m.sits, () => {
      if (clave in m.sits) delete m.sits[clave];
      else m.sits[clave] = [];
      construyeBloques();
    }));
  });
  ficha.appendChild(fS);

  // Subopciones de las situaciones marcadas que las tienen
  Object.keys(m.sits).forEach((clave) => {
    if (!SUBOPC[clave]) return;
    const f = filaCampo(`Detalle ${ (SITS_MIEMBRO.find(([k]) => k === clave) || ["", clave])[1].toLowerCase() }:`);
    SUBOPC[clave].forEach((o) => {
      const on = m.sits[clave].includes(o);
      f.appendChild(miniBtn(o, on, () => {
        const arr = m.sits[clave];
        const idx = arr.indexOf(o);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(o);
        construyeBloques();
      }));
    });
    ficha.appendChild(f);
  });
  return ficha;
}

function construyeBloques() {
  const cont = $("bloques");
  if (!cont) return;
  cont.innerHTML = "";
  cont.appendChild(bloqueHogar());
  const bM = document.createElement("div");
  bM.className = "bloque";
  bM.innerHTML = "<h3>Los miembros</h3>";
  const cuerpo = document.createElement("div"); cuerpo.className = "grupo-paneles";
  for (let i = 0; i < HOGAR.numMiembros; i++) cuerpo.appendChild(fichaMiembro(i));
  bM.appendChild(cuerpo);
  cont.appendChild(bM);
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

// Vuelca el estado actual de la UI a un objeto perfil (un perfil = un hogar).
function estadoActual() {
  return {
    hogar: JSON.parse(JSON.stringify(HOGAR)),
    miembros: JSON.parse(JSON.stringify(MIEMBROS)),
    incluirOtras,
    ccaa: $("f-ccaa").value, provincia: $("f-provincia").value, ayto: $("f-ayuntamiento").value,
    tema: $("f-finalidad").value, q: $("busqueda").value,
  };
}
// Carga un objeto perfil en la UI (hogar, miembros, ubicación, tema).
function aplicaEstado(p) {
  p = p || {};
  HOGAR = Object.assign(hogarVacio(), p.hogar || {});
  MIEMBROS = Array.isArray(p.miembros) && p.miembros.length
    ? p.miembros.map((m) => ({ anio: m.anio || "", sits: m.sits || {} }))
    : [miembroVacio()];
  HOGAR.numMiembros = MIEMBROS.length;
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
  const bR = $("refinar"); if (bR) bR.addEventListener("click", aplica);
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
