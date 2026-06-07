"use strict";

// Posibles ubicaciones del catálogo (según se sirva desde web/ o desde la raíz).
const RUTAS_DATOS = ["ayudas.json", "../data/ayudas.json", "data/ayudas.json"];

let TODAS = [];
let CIRC_LABELS = {};
const circSel = new Set();   // circunstancias marcadas por el usuario
let incluirOtras = false;    // incluir también las no relevantes (cultura, eventos…)

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

function inicializaFiltros() {
  rellenaSelect($("f-comunidad"), opcionesUnicas(TODAS.map(territorio)));
  rellenaSelect($("f-finalidad"), opcionesUnicas(TODAS.map((a) => a.finalidad)));
}

// --------------------------------------------------------------------------- //
// Render
// --------------------------------------------------------------------------- //
function tarjeta(a) {
  const li = document.createElement("li");
  li.className = "tarjeta";

  const badges = [];
  if (a.ambito) badges.push(`<span class="badge ambito">${escapa(capitaliza(a.ambito))}</span>`);
  const terr = territorio(a);
  if (terr) badges.push(`<span class="badge">${escapa(capitaliza(terr))}</span>`);
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
  const com = $("f-comunidad").value;
  const fin = $("f-finalidad").value;

  const filtradas = TODAS.filter((a) => {
    if (com && territorio(a) !== com) return false;
    if (fin && a.finalidad !== fin) return false;
    // Circunstancias: si hay marcadas, debe casar al menos una.
    if (circSel.size) {
      const cs = a.circunstancias || [];
      let casa = false;
      for (const c of circSel) if (cs.includes(c)) { casa = true; break; }
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
  if (circSel.size) cola = n === 1 ? " que puede corresponderte" : " que pueden corresponderte";
  else if (!incluirOtras) cola = " para personas y familias";
  else cola = " abiertas";
  $("resumen").textContent = `${n} ayuda${n === 1 ? "" : "s"}` + cola;
  $("vacio").hidden = n !== 0;
}

// Construye los "chips" de circunstancias a partir del catálogo.
function construyeChips() {
  const cont = $("chips");
  if (!cont) return;
  const cuenta = {};
  TODAS.forEach((a) => (a.circunstancias || []).forEach((c) => { cuenta[c] = (cuenta[c] || 0) + 1; }));
  const claves = Object.keys(CIRC_LABELS).filter((c) => cuenta[c]).sort((a, b) => cuenta[b] - cuenta[a]);
  cont.innerHTML = "";
  claves.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.circ = c;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `${escapa(CIRC_LABELS[c])} <span class="chip-n">${cuenta[c]}</span>`;
    // Un clic selecciona; doble clic quita.
    b.addEventListener("click", () => {
      if (!circSel.has(c)) { circSel.add(c); b.setAttribute("aria-pressed", "true"); aplica(); }
    });
    b.addEventListener("dblclick", () => {
      if (circSel.has(c)) { circSel.delete(c); b.setAttribute("aria-pressed", "false"); aplica(); }
    });
    cont.appendChild(b);
  });
}

// --------------------------------------------------------------------------- //
// Arranque
// --------------------------------------------------------------------------- //
async function init() {
  try {
    const datos = await cargar();
    TODAS = datos.ayudas || [];
    CIRC_LABELS = datos.circunstancias_catalogo || {};
    inicializaFiltros();
    construyeChips();
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
  $("f-comunidad").addEventListener("change", aplica);
  $("f-finalidad").addEventListener("change", aplica);
  $("buscar").addEventListener("click", aplica);
  $("busqueda").addEventListener("keydown", (e) => { if (e.key === "Enter") aplica(); });
  const chkOtras = $("incluir-otras");
  if (chkOtras) chkOtras.addEventListener("change", () => { incluirOtras = chkOtras.checked; aplica(); });
}

init();
