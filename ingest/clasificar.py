#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radar de Ayudas — Clasificación por circunstancias (motor de targeting).

Etiqueta cada ayuda con las CIRCUNSTANCIAS personales/familiares a las que sirve
(discapacidad, familia numerosa, desempleo, vivienda, estudios/becas…) y marca
si es de "bienestar familiar" (relevancia_familiar), que es lo que el Radar
muestra por defecto. Lo demás (cultura/eventos, actividad empresarial pura) no
se borra: queda accesible pero oculto por defecto.

Enfoque: la familia no busca por "tipología de subvención", busca "qué me puede
corresponder". El targeting real lo hace este motor, no el tipo de beneficiario.

Clasificación por palabras clave sobre título + finalidad + organismo. Rápida,
gratis y afinable. Solo librería estándar.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def na(texto: str) -> str:
    """Normaliza: minúsculas y sin acentos, para casar palabras clave."""
    t = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


# Etiqueta -> nombre legible + palabras clave (ya sin acentos).
# El orden no importa; una ayuda puede tener varias circunstancias.
CIRCUNSTANCIAS = {
    "discapacidad":      ("Discapacidad",            ["discapacid", "minusval", "diversidad funcional", "gran invalid"]),
    "dependencia":       ("Dependencia y cuidados",  ["dependencia", "gran dependiente", "autonomia personal", "cuidados de larga"]),
    "familia_numerosa":  ("Familia numerosa",        ["familia numerosa", "familias numerosas"]),
    "monoparental":      ("Familia monoparental",    ["monoparental", "monomarental"]),
    "desempleo":         ("Desempleo",               ["desemple", "parad", "demandante de empleo", "insercion laboral", "busqueda de empleo", "larga duracion", "mayores de 45", "mayores de 52", "recualificac"]),
    "hijos_natalidad":   ("Hijos y natalidad",       ["natalidad", "nacimiento", "hijo", "menores", "infancia", "conciliacion", "guarderia", "escuela infantil", "cheque bebe", "ayuda al nacimiento", "0-3", "primer ciclo"]),
    "vivienda":          ("Vivienda y alquiler",     ["vivienda", "alquiler", "hipoteca", "emancipacion", "arrendamiento", "fianza", "suministros minimos vitales", "pobreza energetica"]),
    "estudios_becas":    ("Estudios y becas",        ["beca", "estudiant", "material escolar", "comedor escolar", "transporte escolar", "universi", "formacion", "matricula", "libros de texto", "ayuda al estudio"]),
    "mayores":           ("Personas mayores",        ["mayores", "tercera edad", "pensionist", "envejecimiento", "personas de edad"]),
    "jovenes":           ("Jóvenes",                 ["joven", "juventud"]),
    "mujer":             ("Mujer e igualdad",        ["mujer", "mujeres"]),
    "violencia_genero":  ("Violencia de género",     ["violencia de genero", "violencia machista", "victimas de violencia", "violencia sobre la mujer"]),
    "salud":             ("Salud y enfermedad",      ["enferm", "tratamiento medic", "oftalm", "optic", "dental", "protesis", "audifono", "farmac", "rehabilitacion funcional", "salud mental", "oncolog"]),
    "cuidadores":        ("Personas cuidadoras",     ["cuidador", "persona cuidadora"]),
    "vulnerabilidad":    ("Vulnerabilidad y emergencia", ["emergencia social", "vulnerabilidad", "exclusion", "pobreza", "necesidades basicas", "ayuda de emergencia", "atencion social", "situacion de necesidad", "renta minima", "ingreso minimo", "garantia alimentaria", "ayuda asistencial", "beneficas y asistenciales", "prestaciones sociales"]),
    "migracion":         ("Migración y retorno",     ["migrant", "inmigra", "refugiad", "retorno", "asilo"]),
    "energia_vivienda":  ("Rehabilitación y energía del hogar", ["rehabilitacion de vivienda", "eficiencia energetica", "autoconsumo", "placas solares", "fotovoltaic", "aislamiento", "rehabilitacion energetica", "calefaccion"]),
    "rural":             ("Medio rural",             ["medio rural", "despoblacion", "nucleo rural", "zona rural"]),
    # Opt-in / no es bienestar familiar por defecto:
    "autonomo":          ("Autónomos y emprendimiento", ["autonomo", "cuenta propia", "emprend", "autoempleo", "cuota cero", "autoocupacion"]),
    "cultura_deporte":   ("Cultura y deporte",       ["cultura", "cultural", "music", "danza", "arte", "pintura", "grabado", "banda", "cabalgata", "fiesta", "certamen", "concurso", "premio", "deporte", "deportiv", "festival", "carnaval", "belen", "teatro"]),
}

# Circunstancias que cuentan como "bienestar familiar" (visibles por defecto).
FAMILIARES = {
    "discapacidad", "dependencia", "familia_numerosa", "monoparental", "desempleo",
    "hijos_natalidad", "vivienda", "estudios_becas", "mayores", "jovenes", "mujer",
    "violencia_genero", "salud", "cuidadores", "vulnerabilidad", "migracion",
    "energia_vivienda",
}

# Finalidades de BDNS que son de bienestar (relevantes aunque el título no case).
FINALIDADES_BIENESTAR = {
    na("Servicios Sociales y Promoción Social"),
    na("Acceso a la vivienda y fomento de la edificación"),
    na("Educación"),
    na("Fomento del Empleo"),
    na("Desempleo"),
    na("Otras Prestaciones económicas"),
    na("Sanidad"),
}


def clasifica(a: dict) -> tuple[list, bool]:
    texto = na(f"{a.get('titulo','')} {a.get('finalidad','')} {a.get('organo','')}")
    circ = []
    for clave, (_, kws) in CIRCUNSTANCIAS.items():
        if any(k in texto for k in kws):
            circ.append(clave)
    fin = na(a.get("finalidad", ""))
    relevante = any(c in FAMILIARES for c in circ) or fin in FINALIDADES_BIENESTAR
    return circ, relevante


def main():
    p = argparse.ArgumentParser(description="Clasifica el catálogo por circunstancias.")
    p.add_argument("--catalogo", default=str(RAIZ / "data" / "ayudas.json"))
    args = p.parse_args()

    ruta = Path(args.catalogo)
    d = json.loads(ruta.read_text(encoding="utf-8"))
    ay = d["ayudas"]

    cont = Counter()
    rel = 0
    for a in ay:
        circ, relevante = clasifica(a)
        a["circunstancias"] = circ
        a["relevancia_familiar"] = relevante
        for c in circ:
            cont[c] += 1
        if relevante:
            rel += 1

    # Diccionario de etiquetas legibles para la web
    d["circunstancias_catalogo"] = {k: v[0] for k, v in CIRCUNSTANCIAS.items()}
    ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    n = len(ay)
    print(f"  · clasificadas {n} ayudas | relevancia_familiar: {rel} ({100*rel//n}%) | "
          f"sin circunstancia: {sum(1 for a in ay if not a['circunstancias'])}")
    print("  · por circunstancia:")
    for clave, (nombre, _) in CIRCUNSTANCIAS.items():
        print(f"      {nombre:<34} {cont.get(clave,0)}")


if __name__ == "__main__":
    main()
