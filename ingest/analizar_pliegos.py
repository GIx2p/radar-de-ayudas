# -*- coding: utf-8 -*-
"""Lee una muestra grande de pliegos y cuantifica los patrones de clasificación
de candidatos (residencia, ingresos, edad, discapacidad, familia, laboral...),
capturando además los valores reales (tramos IPREM, edades, grados, etc.)."""
import json, re, urllib.request, urllib.parse, collections
from pathlib import Path
from pypdf import PdfReader
RAIZ=Path(__file__).resolve().parents[1]; CACHE=RAIZ/"ingest"/".cache"; CACHE.mkdir(parents=True,exist_ok=True)
B="https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?idDocumento="
d=json.load(open(RAIZ/"data"/"ayudas.json",encoding="utf-8")); ay=d["ayudas"]

# Selección diversa: family-relevant, con documento y bases vivas, round-robin por finalidad
porfin=collections.defaultdict(list)
for a in ay:
    if a.get("relevancia_familiar") and a.get("documentos") and a.get("bases_estado")=="ok":
        porfin[a.get("finalidad")].append(a)
sel=[]; i=0
while len(sel)<50 and any(porfin.values()):
    for f in list(porfin):
        if porfin[f]:
            sel.append(porfin[f].pop(0))
            if len(sel)>=50: break

def descarga(a):
    f=CACHE/f"proto_{a['id']}.pdf"
    if not f.exists():
        try:
            doc=a["documentos"][0]["id"]
            req=urllib.request.Request(B+str(doc),headers={"User-Agent":"radar/0.1"})
            f.write_bytes(urllib.request.urlopen(req,timeout=50).read())
        except Exception: return None
    return f
def texto(f):
    try: return re.sub(r"[ \t\n]+"," ","\n".join((p.extract_text() or "") for p in PdfReader(f).pages).lower())
    except Exception: return ""

DIM={
 "residencia":[r"empadronad",r"residencia",r"vecindad",r"domiciliad"],
 "ingresos/renta":[r"iprem",r"renta per c[áa]pita",r"l[íi]mite de ingresos",r"umbral de renta",r"ingresos.{0,25}unidad familiar",r"nivel de renta"],
 "edad":[r"\bmenores de \d+",r"\bmayores de \d+",r"entre \d+ y \d+ años",r"de \d+ a \d+ años"],
 "discapacidad+grado":[r"discapacidad.{0,25}\d{2}\s*%",r"grado.{0,15}discapacidad",r"igual o superior al \d{2}"],
 "familia numerosa":[r"familia numerosa"],
 "monoparental":[r"monoparental|monomarental"],
 "hijos/menores a cargo":[r"hijos? a cargo",r"menores a cargo",r"hijos? menores",r"descendientes"],
 "unidad familiar":[r"unidad familiar",r"unidad de convivencia",r"miembros de la"],
 "desempleo":[r"desemple",r"demandante de empleo"],
 "autonomo":[r"aut[óo]nomo|cuenta propia"],
 "pensionista/mayor":[r"pensionista",r"jubilad"],
 "dependencia":[r"depend(encia|iente)"],
 "violencia genero":[r"violencia de g[ée]nero|violencia machista"],
 "vulnerabilidad/exclusion":[r"vulnerab",r"riesgo de exclusi[óo]n",r"emergencia social"],
 "estudiante":[r"matriculad|estudiante|alumnado"],
 "nacionalidad/extranjeria":[r"nacionalidad",r"permiso de residencia",r"extranjer"],
}
def snip(t,pat,n=120):
    m=re.search(pat,t)
    if not m: return None
    s=max(0,m.start()-40); return t[s:m.start()+n].strip()

freq=collections.Counter(); ejem=collections.defaultdict(list); leidos=0
for a in sel:
    f=descarga(a)
    if not f: continue
    t=texto(f)
    if len(t)<200: continue
    leidos+=1
    for dim,ps in DIM.items():
        if any(re.search(p,t) for p in ps):
            freq[dim]+=1
            if dim in ("ingresos/renta","edad","discapacidad+grado","familia numerosa") and len(ejem[dim])<4:
                for p in ps:
                    s=snip(t,p)
                    if s: ejem[dim].append(s[:140]); break
print(f"PLIEGOS LEÍDOS: {leidos}\n")
print("FRECUENCIA DE CADA PATRÓN DE CLASIFICACIÓN:")
for dim,_ in DIM.items():
    n=freq[dim]; pct=round(100*n/max(leidos,1))
    print(f"  {dim:26} {n:3}/{leidos}  ({pct:3}%)")
print("\nEJEMPLOS REALES (para definir las opciones):")
for dim in ("ingresos/renta","edad","discapacidad+grado","familia numerosa"):
    print(f"\n[{dim}]")
    for e in ejem[dim]: print("   …",e)
