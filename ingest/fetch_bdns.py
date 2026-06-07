#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radar de Ayudas — Ingesta desde la API oficial de BDNS (SNPSAP).

Descarga convocatorias de subvenciones, las filtra a las dirigidas a personas
físicas / familias, se queda con las que están ABIERTAS y las normaliza a un
único fichero JSON (data/ayudas.json) que alimenta la web.

No usa dependencias externas: solo la librería estándar de Python 3.
Fuente: https://www.infosubvenciones.es/bdnstrans/api

Aviso legal de reutilización de datos:
https://www.infosubvenciones.es/bdnstrans/GE/es/avisolegal

Ejemplos:
  # Ventana de los últimos 12 meses (def), guarda en data/ayudas.json
  python ingest/fetch_bdns.py
  # Prueba rápida: solo 60 candidatas
  python ingest/fetch_bdns.py --max-candidatas 60
  # Rango de fechas explícito
  python ingest/fetch_bdns.py --fecha-desde 01/01/2026 --fecha-hasta 07/06/2026
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Configuración de la API
# --------------------------------------------------------------------------- #
BASE = "https://www.infosubvenciones.es/bdnstrans/api"
EP_BUSQUEDA = f"{BASE}/convocatorias/busqueda"
EP_DETALLE = f"{BASE}/convocatorias"
PORTAL_FICHA = "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias"

VPD = "GE"  # portal general (todo el Estado)
USER_AGENT = "radar-de-ayudas/0.1 (proyecto sin ánimo de lucro; datos abiertos BDNS)"

# Tipo de beneficiario relevante para familias/personas:
#   1 = PERSONAS FÍSICAS QUE NO DESARROLLAN ACTIVIDAD ECONÓMICA
BENEFICIARIO_PERSONAS_FISICAS = "1"

TIMEOUT = 30
RAIZ = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(__file__).resolve().parent / ".cache"


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def http_get_json(url: str, params: dict, intentos: int = 4, espera: float = 2.5):
    """GET con parámetros, devuelve JSON. Reintenta ante fallos de red."""
    query = urllib.parse.urlencode(params, doseq=True)
    full = f"{url}?{query}"
    ultimo_error = None
    for intento in range(1, intentos + 1):
        try:
            req = urllib.request.Request(full, headers={
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            ultimo_error = e
            if intento < intentos:
                time.sleep(espera * intento)  # backoff creciente
    raise RuntimeError(f"Fallo al pedir {full}: {ultimo_error}")


def fecha_meses_atras(meses: int) -> str:
    """Devuelve la fecha de hace `meses` meses en formato dd/MM/yyyy."""
    hoy = date.today()
    total = (hoy.year * 12 + (hoy.month - 1)) - meses
    anio, mes = divmod(total, 12)
    mes += 1
    dia = min(hoy.day, 28)  # evita problemas con fin de mes
    return f"{dia:02d}/{mes:02d}/{anio:04d}"


# --------------------------------------------------------------------------- #
# Búsqueda de convocatorias candidatas (lista ligera, paginada)
# --------------------------------------------------------------------------- #
def buscar_candidatas(beneficiarios, fecha_desde, fecha_hasta, max_paginas, page_size, pausa):
    """Genera items de la lista de convocatorias ordenadas por recepción desc."""
    params_base = {
        "vpd": VPD,
        "pageSize": page_size,
        "order": "fechaRecepcion",
        "direccion": "desc",
        "tiposBeneficiario": beneficiarios,
    }
    if fecha_desde:
        params_base["fechaDesde"] = fecha_desde
    if fecha_hasta:
        params_base["fechaHasta"] = fecha_hasta

    primera = http_get_json(EP_BUSQUEDA, {**params_base, "page": 0})
    total_paginas = primera.get("totalPages", 1)
    total_elementos = primera.get("totalElements", 0)
    paginas = total_paginas if max_paginas == 0 else min(max_paginas, total_paginas)
    print(f"  · candidatas en ventana: {total_elementos} "
          f"({total_paginas} pág.); se leerán {paginas}", file=sys.stderr)

    for item in primera.get("content", []):
        yield item
    for page in range(1, paginas):
        time.sleep(pausa)
        datos = http_get_json(EP_BUSQUEDA, {**params_base, "page": page})
        for item in datos.get("content", []):
            yield item


# --------------------------------------------------------------------------- #
# Detalle (con caché en disco) + normalización
# --------------------------------------------------------------------------- #
def obtener_detalle(num_conv: str, usar_cache: bool = True, delay: float = 0.0):
    cache = CACHE_DIR / f"{num_conv}.json"
    if usar_cache and cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass  # caché corrupta -> se vuelve a pedir
    if delay:
        time.sleep(delay)  # freno de cortesía con la API
    datos = http_get_json(EP_DETALLE, {"vpd": VPD, "numConv": num_conv})
    if usar_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            cache.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    return datos


def limpia_url(v):
    """Normaliza una URL: quita espacios (incluidos los internos erróneos) y
    añade https:// si falta el esquema. Devuelve None si queda vacía."""
    if not v:
        return None
    s = "".join(str(v).split())  # elimina todos los espacios en blanco
    if not s:
        return None
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s.lstrip("/")
    return s


def esta_abierta(a: dict, hoy: str) -> bool:
    """Una ayuda está abierta para solicitar si:
    - BDNS la marca como `abierto=True` (programas sin plazo, siempre abiertos), o
    - hoy cae dentro del plazo de solicitud [fecha_inicio, fecha_fin].
    OJO: el flag `abierto` de BDNS NO equivale a "en plazo"; muchas convocatorias
    de concurrencia competitiva con plazo vigente vienen con abierto=False.
    """
    if a.get("abierto") is True:
        return True
    ini, fin = a.get("fecha_inicio"), a.get("fecha_fin")
    return bool(ini and fin and ini <= hoy <= fin)


def _lista_desc(valores):
    out = []
    for v in valores or []:
        if isinstance(v, dict) and v.get("descripcion"):
            out.append(v["descripcion"].strip())
    return out


def normalizar(detalle: dict) -> dict:
    organo = detalle.get("organo") or {}
    documentos = [
        {
            "id": d.get("id"),
            "descripcion": (d.get("descripcion") or "").strip(),
            "nombre": d.get("nombreFic"),
        }
        for d in (detalle.get("documentos") or [])
    ]
    interno = detalle.get("id")
    return {
        "id": detalle.get("codigoBDNS"),
        "id_interno": interno,
        "titulo": (detalle.get("descripcion") or "").strip(),
        "ambito": organo.get("nivel1"),          # ESTATAL / AUTONOMICA / LOCAL / OTROS
        "comunidad": organo.get("nivel2"),
        "organo": organo.get("nivel3"),
        "finalidad": detalle.get("descripcionFinalidad"),
        "regiones": _lista_desc(detalle.get("regiones")),  # p.ej. "ES30 - COMUNIDAD DE MADRID"
        "beneficiarios": _lista_desc(detalle.get("tiposBeneficiarios")),
        "instrumentos": _lista_desc(detalle.get("instrumentos")),
        "importe_total": detalle.get("presupuestoTotal"),
        "mrr": detalle.get("mrr"),
        "abierto": detalle.get("abierto"),
        "fecha_inicio": detalle.get("fechaInicioSolicitud"),
        "fecha_fin": detalle.get("fechaFinSolicitud"),
        "fecha_recepcion": detalle.get("fechaRecepcion"),
        "url_bases": limpia_url(detalle.get("urlBasesReguladoras")),
        "sede_electronica": limpia_url(detalle.get("sedeElectronica")),
        "url_ficha": f"{PORTAL_FICHA}/{detalle.get('codigoBDNS')}" if detalle.get("codigoBDNS") else None,
        "documentos": documentos,
    }


# --------------------------------------------------------------------------- #
# Programa principal
# --------------------------------------------------------------------------- #
def main():
    p = argparse.ArgumentParser(description="Ingesta de ayudas desde BDNS.")
    p.add_argument("--beneficiarios", default=BENEFICIARIO_PERSONAS_FISICAS,
                   help="Códigos de tipo de beneficiario, coma. 1=personas físicas (def).")
    p.add_argument("--meses", type=int, default=12,
                   help="Ventana hacia atrás en meses (def: 12). Ignorado si se da --fecha-desde.")
    p.add_argument("--fecha-desde", default=None, help="dd/MM/yyyy (sobrescribe --meses).")
    p.add_argument("--fecha-hasta", default=None, help="dd/MM/yyyy (def: hoy).")
    p.add_argument("--max-paginas", type=int, default=0,
                   help="Páginas de candidatas (0 = todas en la ventana). Def: 0.")
    p.add_argument("--page-size", type=int, default=1000,
                   help="Resultados por página de búsqueda (máx 10000). Def: 1000.")
    p.add_argument("--max-candidatas", type=int, default=0,
                   help="Límite de candidatas a enriquecer (0 = sin límite). Para pruebas.")
    p.add_argument("--workers", type=int, default=5,
                   help="Hilos concurrentes para el detalle. Def: 5.")
    p.add_argument("--pausa", type=float, default=0.3,
                   help="Pausa entre páginas de búsqueda (seg). Def: 0.3.")
    p.add_argument("--delay", type=float, default=0.0,
                   help="Freno por petición de detalle (seg). Útil en CI. Def: 0.")
    p.add_argument("--sin-cache", action="store_true", help="No usar la caché de detalle.")
    p.add_argument("--todas", action="store_true",
                   help="No filtrar por 'abierto'; incluir también cerradas.")
    p.add_argument("--salida", default=str(RAIZ / "data" / "ayudas.json"),
                   help="Ruta del JSON de salida.")
    args = p.parse_args()

    beneficiarios = [b.strip() for b in args.beneficiarios.split(",") if b.strip()]
    fecha_desde = args.fecha_desde or fecha_meses_atras(args.meses)
    fecha_hasta = args.fecha_hasta or date.today().strftime("%d/%m/%Y")
    usar_cache = not args.sin_cache
    t0 = time.time()

    print("Radar de Ayudas — ingesta BDNS", file=sys.stderr)
    print(f"  · beneficiarios: {beneficiarios} | ventana: {fecha_desde} → {fecha_hasta}",
          file=sys.stderr)

    # 1) Candidatas (lista ligera)
    candidatas = []
    for item in buscar_candidatas(beneficiarios, fecha_desde, fecha_hasta,
                                  args.max_paginas, args.page_size, args.pausa):
        candidatas.append(item)
        if args.max_candidatas and len(candidatas) >= args.max_candidatas:
            break
    print(f"  · candidatas recogidas: {len(candidatas)}", file=sys.stderr)

    # 2) Enriquecer con el detalle (concurrente, con caché)
    detalles = []
    nums = [c.get("numeroConvocatoria") for c in candidatas if c.get("numeroConvocatoria")]
    errores = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futuros = {ex.submit(obtener_detalle, n, usar_cache, args.delay): n for n in nums}
        for i, fut in enumerate(as_completed(futuros), 1):
            try:
                detalles.append(fut.result())
            except Exception as e:  # noqa: BLE001
                errores += 1
                print(f"    ! error en {futuros[fut]}: {e}", file=sys.stderr)
            if i % 250 == 0:
                print(f"    · detalle {i}/{len(nums)}  ({time.time()-t0:.0f}s)", file=sys.stderr)

    # 3) Normalizar + filtrar abiertas (abierto=True O dentro del plazo de solicitud)
    hoy = date.today().isoformat()
    ayudas = [normalizar(d) for d in detalles]
    if not args.todas:
        ayudas = [a for a in ayudas if esta_abierta(a, hoy)]
    for a in ayudas:
        a["sin_plazo"] = a.get("fecha_fin") is None  # programa sin fecha de cierre
    # ordena: las que vencen antes primero; las sin plazo, al final
    ayudas.sort(key=lambda a: a.get("fecha_fin") or "9999-99-99")

    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": "BDNS — Sistema Nacional de Publicidad de Subvenciones (SNPSAP)",
        "aviso_legal": "https://www.infosubvenciones.es/bdnstrans/GE/es/avisolegal",
        "ventana": {"desde": fecha_desde, "hasta": fecha_hasta},
        "filtro_beneficiarios": beneficiarios,
        "solo_abiertas": not args.todas,
        "candidatas_evaluadas": len(nums),
        "errores": errores,
        "total": len(ayudas),
        "ayudas": ayudas,
    }

    ruta = Path(args.salida)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  · {len(ayudas)} ayudas abiertas de {len(nums)} evaluadas "
          f"(errores: {errores}) en {time.time()-t0:.0f}s → {ruta}", file=sys.stderr)


if __name__ == "__main__":
    main()
