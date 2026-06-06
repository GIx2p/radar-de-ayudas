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
"""

from __future__ import annotations

import argparse
import json
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
PORTAL_FICHA = "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria"

VPD = "GE"  # portal general (todo el Estado)
USER_AGENT = "radar-de-ayudas/0.1 (proyecto sin ánimo de lucro; datos abiertos BDNS)"

# Tipo de beneficiario relevante para familias/personas:
#   1 = PERSONAS FÍSICAS QUE NO DESARROLLAN ACTIVIDAD ECONÓMICA
BENEFICIARIO_PERSONAS_FISICAS = "1"

TIMEOUT = 30


# --------------------------------------------------------------------------- #
# Utilidades HTTP
# --------------------------------------------------------------------------- #
def http_get_json(url: str, params: dict, intentos: int = 3, espera: float = 2.0):
    """GET con parámetros, devuelve JSON. Reintenta ante fallos de red."""
    # tiposBeneficiario y similares pueden ir repetidos; urlencode con doseq
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
                datos = json.loads(resp.read().decode("utf-8"))
            return datos
        except Exception as e:  # noqa: BLE001
            ultimo_error = e
            if intento < intentos:
                time.sleep(espera)
    raise RuntimeError(f"Fallo al pedir {full}: {ultimo_error}")


# --------------------------------------------------------------------------- #
# Búsqueda de convocatorias candidatas (lista ligera, paginada)
# --------------------------------------------------------------------------- #
def buscar_candidatas(beneficiarios, max_paginas, page_size, pausa):
    """Genera items de la lista de convocatorias ordenadas por recepción desc."""
    params_base = {
        "vpd": VPD,
        "pageSize": page_size,
        "order": "fechaRecepcion",
        "direccion": "desc",
        "tiposBeneficiario": beneficiarios,  # lista -> doseq
    }
    primera = http_get_json(EP_BUSQUEDA, {**params_base, "page": 0})
    total_paginas = primera.get("totalPages", 1)
    total_elementos = primera.get("totalElements", 0)
    paginas = total_paginas if max_paginas == 0 else min(max_paginas, total_paginas)
    print(f"  · candidatas totales según API: {total_elementos} "
          f"({total_paginas} páginas); se leerán {paginas}", file=sys.stderr)

    for item in primera.get("content", []):
        yield item
    for page in range(1, paginas):
        time.sleep(pausa)
        datos = http_get_json(EP_BUSQUEDA, {**params_base, "page": page})
        for item in datos.get("content", []):
            yield item


# --------------------------------------------------------------------------- #
# Detalle + normalización
# --------------------------------------------------------------------------- #
def obtener_detalle(num_conv: str):
    return http_get_json(EP_DETALLE, {"vpd": VPD, "numConv": num_conv})


def _lista_desc(valores):
    """Convierte [{'descripcion': x}, ...] -> [x, ...]."""
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
    codigo = detalle.get("codigoBDNS")
    interno = detalle.get("id")
    return {
        "id": codigo,
        "id_interno": interno,
        "titulo": (detalle.get("descripcion") or "").strip(),
        "ambito": organo.get("nivel1"),          # ESTATAL / AUTONOMICA / LOCAL
        "comunidad": organo.get("nivel2"),        # CCAA u organismo
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
        "url_bases": (detalle.get("urlBasesReguladoras") or "").strip() or None,
        "sede_electronica": detalle.get("sedeElectronica"),
        "url_ficha": f"{PORTAL_FICHA}/{interno}" if interno else None,
        "documentos": documentos,
    }


# --------------------------------------------------------------------------- #
# Programa principal
# --------------------------------------------------------------------------- #
def main():
    p = argparse.ArgumentParser(description="Ingesta de ayudas desde BDNS.")
    p.add_argument("--beneficiarios", default=BENEFICIARIO_PERSONAS_FISICAS,
                   help="Códigos de tipo de beneficiario, separados por coma. "
                        "1=personas físicas (def).")
    p.add_argument("--max-paginas", type=int, default=1,
                   help="Páginas de candidatas a leer (0 = todas). Def: 1.")
    p.add_argument("--page-size", type=int, default=200,
                   help="Resultados por página (máx 10000). Def: 200.")
    p.add_argument("--max-candidatas", type=int, default=0,
                   help="Límite de candidatas a enriquecer (0 = sin límite).")
    p.add_argument("--workers", type=int, default=4,
                   help="Hilos concurrentes para el detalle. Def: 4.")
    p.add_argument("--pausa", type=float, default=0.3,
                   help="Pausa entre páginas de búsqueda (seg). Def: 0.3.")
    p.add_argument("--todas", action="store_true",
                   help="No filtrar por 'abierto'; incluir también cerradas.")
    p.add_argument("--salida", default=str(Path(__file__).resolve().parents[1] / "data" / "ayudas.json"),
                   help="Ruta del JSON de salida.")
    args = p.parse_args()

    beneficiarios = [b.strip() for b in args.beneficiarios.split(",") if b.strip()]

    print("Radar de Ayudas — ingesta BDNS", file=sys.stderr)
    print(f"  · beneficiarios: {beneficiarios}", file=sys.stderr)

    # 1) Candidatas (lista ligera)
    candidatas = []
    for item in buscar_candidatas(beneficiarios, args.max_paginas, args.page_size, args.pausa):
        candidatas.append(item)
        if args.max_candidatas and len(candidatas) >= args.max_candidatas:
            break
    print(f"  · candidatas recogidas: {len(candidatas)}", file=sys.stderr)

    # 2) Enriquecer con el detalle (concurrente)
    detalles = []
    nums = [c.get("numeroConvocatoria") for c in candidatas if c.get("numeroConvocatoria")]
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futuros = {ex.submit(obtener_detalle, n): n for n in nums}
        for i, fut in enumerate(as_completed(futuros), 1):
            try:
                detalles.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"    ! error en {futuros[fut]}: {e}", file=sys.stderr)
            if i % 25 == 0:
                print(f"    · detalle {i}/{len(nums)}", file=sys.stderr)

    # 3) Normalizar + filtrar abiertas
    ayudas = [normalizar(d) for d in detalles]
    if not args.todas:
        ayudas = [a for a in ayudas if a.get("abierto") is True]
    ayudas.sort(key=lambda a: a.get("fecha_fin") or "9999", reverse=False)

    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": "BDNS — Sistema Nacional de Publicidad de Subvenciones (SNPSAP)",
        "aviso_legal": "https://www.infosubvenciones.es/bdnstrans/GE/es/avisolegal",
        "filtro_beneficiarios": beneficiarios,
        "solo_abiertas": not args.todas,
        "total": len(ayudas),
        "ayudas": ayudas,
    }

    ruta = Path(args.salida)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  · escritas {len(ayudas)} ayudas (abiertas) en {ruta}", file=sys.stderr)


if __name__ == "__main__":
    main()
