# -*- coding: utf-8 -*-
"""Construye web/geo.json (compacto) para la cascada Comunidad->Provincia->Ayuntamiento,
a partir de los datos oficiales del INE (codeforspain)."""
import json, urllib.request
from pathlib import Path
RAIZ = Path(__file__).resolve().parents[1]
BASE = "https://raw.githubusercontent.com/codeforspain/ds-organizacion-administrativa/master/data"
def baja(n):
    return json.loads(urllib.request.urlopen(f"{BASE}/{n}", timeout=60).read())

# Mapa código de provincia (INE) -> Comunidad Autónoma
PROV_CCAA = {
 "01":"País Vasco","48":"País Vasco","20":"País Vasco","31":"Navarra","26":"La Rioja",
 "22":"Aragón","44":"Aragón","50":"Aragón","08":"Cataluña","17":"Cataluña","25":"Cataluña","43":"Cataluña",
 "03":"Comunidad Valenciana","12":"Comunidad Valenciana","46":"Comunidad Valenciana",
 "07":"Illes Balears","28":"Madrid",
 "05":"Castilla y León","09":"Castilla y León","24":"Castilla y León","34":"Castilla y León","37":"Castilla y León","40":"Castilla y León","42":"Castilla y León","47":"Castilla y León","49":"Castilla y León",
 "02":"Castilla-La Mancha","13":"Castilla-La Mancha","16":"Castilla-La Mancha","19":"Castilla-La Mancha","45":"Castilla-La Mancha",
 "06":"Extremadura","10":"Extremadura",
 "15":"Galicia","27":"Galicia","32":"Galicia","36":"Galicia",
 "33":"Asturias","39":"Cantabria",
 "04":"Andalucía","11":"Andalucía","14":"Andalucía","18":"Andalucía","21":"Andalucía","23":"Andalucía","29":"Andalucía","41":"Andalucía",
 "30":"Región de Murcia","35":"Canarias","38":"Canarias","51":"Ceuta","52":"Melilla",
}
prov = baja("provincias.json")
muni = baja("municipios.json")
provincias = [{"id":p["provincia_id"],"nombre":p["nombre"],"ccaa":PROV_CCAA.get(p["provincia_id"],"?")} for p in prov]
municipios = {}
for m in muni:
    municipios.setdefault(m["provincia_id"], []).append(m["nombre"])
for k in municipios: municipios[k].sort()
out = {"provincias": sorted(provincias, key=lambda x:x["nombre"]), "municipios": municipios}
ruta = RAIZ/"web"/"geo.json"
ruta.write_text(json.dumps(out, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
print("provincias:", len(provincias), "| municipios:", sum(len(v) for v in municipios.values()))
print("CCAA:", sorted(set(p["ccaa"] for p in provincias)))
print("sin mapear:", [p["nombre"] for p in provincias if p["ccaa"]=="?"])
print("tamaño geo.json:", ruta.stat().st_size, "bytes")
