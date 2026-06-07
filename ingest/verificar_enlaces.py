#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radar de Ayudas — Verificación de enlaces.

Comprueba los enlaces (url_bases y sede_electronica) del catálogo y anota su
estado en cada ayuda, para que la web pueda ocultar/avisar de los rotos.

Clasificación CONSERVADORA (no marcar "muerto" lo que solo bloquea bots):
  - "ok"      : respuesta 2xx/3xx
  - "muerto"  : 404/410, o el dominio no resuelve en DNS (no existe)
  - "dudoso"  : 403/405/5xx, timeouts, errores de certificado… (se sigue mostrando)

La ficha de BDNS no se comprueba (es una SPA que siempre responde 200).
Solo librería estándar. Caché en disco con TTL para no recomprobar a diario.
"""

from __future__ import annotations

import argparse
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
CACHE = Path(__file__).resolve().parent / ".cache_enlaces.json"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 10
CTX = ssl.create_default_context()


def host_resuelve(url: str) -> bool:
    try:
        host = urllib.parse.urlparse(url).hostname
        if not host:
            return False
        socket.getaddrinfo(host, None)
        return True
    except Exception:  # noqa: BLE001
        return False


def comprobar(url: str) -> str:
    """Devuelve 'ok' | 'muerto' | 'dudoso' para una URL."""
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": UA,
        "Accept": "*/*",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
            code = r.getcode()
            return "ok" if 200 <= code < 400 else (
                "muerto" if code in (404, 410) else "dudoso")
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return "muerto"
        return "dudoso"  # 403/405/5xx -> a menudo bloqueo de bots, no muerto
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, ConnectionError, Exception):  # noqa: BLE001
        # Sin conexión: solo es "muerto" si además el dominio no existe en DNS.
        return "muerto" if not host_resuelve(url) else "dudoso"


def cargar_cache(ttl_dias: int) -> dict:
    if not CACHE.exists():
        return {}
    try:
        data = json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    ahora = time.time()
    return {u: v for u, v in data.items()
            if isinstance(v, dict) and (ahora - v.get("ts", 0)) < ttl_dias * 86400}


def main():
    p = argparse.ArgumentParser(description="Verifica los enlaces del catálogo.")
    p.add_argument("--catalogo", default=str(RAIZ / "data" / "ayudas.json"))
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--ttl-dias", type=int, default=15,
                   help="Reusar resultados de caché más recientes que esto.")
    p.add_argument("--sin-cache", action="store_true")
    args = p.parse_args()

    ruta = Path(args.catalogo)
    d = json.loads(ruta.read_text(encoding="utf-8"))
    ay = d["ayudas"]

    # URLs únicas a comprobar (bases + sede)
    urls = set()
    for a in ay:
        for c in ("url_bases", "sede_electronica"):
            if a.get(c):
                urls.add(a[c])

    cache = {} if args.sin_cache else cargar_cache(args.ttl_dias)
    pendientes = [u for u in urls if u not in cache]
    print(f"  · URLs únicas: {len(urls)} | en caché: {len(urls)-len(pendientes)} | "
          f"a comprobar: {len(pendientes)}")

    estados = {u: cache[u]["estado"] for u in urls if u in cache}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        fut = {ex.submit(comprobar, u): u for u in pendientes}
        for i, f in enumerate(as_completed(fut), 1):
            u = fut[f]
            try:
                estados[u] = f.result()
            except Exception:  # noqa: BLE001
                estados[u] = "dudoso"
            if i % 200 == 0:
                print(f"    · {i}/{len(pendientes)} ({time.time()-t0:.0f}s)")

    # Guarda caché
    nueva = {u: {"estado": e, "ts": time.time()} for u, e in estados.items()}
    try:
        CACHE.write_text(json.dumps(nueva, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    # Anota en el catálogo
    resumen = {"ok": 0, "muerto": 0, "dudoso": 0}
    for a in ay:
        for c, campo in (("url_bases", "bases_estado"), ("sede_electronica", "sede_estado")):
            est = estados.get(a.get(c)) if a.get(c) else None
            a[campo] = est
            if est in resumen:
                resumen[est] += 1
    d["enlaces_verificados"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  · enlaces -> ok:{resumen['ok']} muerto:{resumen['muerto']} "
          f"dudoso:{resumen['dudoso']} ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
