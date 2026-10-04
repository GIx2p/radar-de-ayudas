# -*- coding: utf-8 -*-
import json, re, urllib.request, collections
from pathlib import Path
from pypdf import PdfReader
RAIZ=Path(__file__).resolve().parents[1]; CACHE=RAIZ/"ingest"/".cache"; CACHE.mkdir(parents=True,exist_ok=True)
B="https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?idDocumento="
ay=json.load(open(RAIZ/"data"/"ayudas.json",encoding="utf-8"))["ayudas"]
porfin=collections.defaultdict(list)
for a in ay:
    if a.get("relevancia_familiar") and a.get("documentos") and a.get("bases_estado")=="ok":
        porfin[a.get("finalidad")].append(a)
sel=[]
while len(sel)<150 and any(porfin.values()):
    for f in list(porfin):
        if porfin[f]: sel.append(porfin[f].pop(0))
        if len(sel)>=150: break
def descarga(a):
    f=CACHE/f"proto_{a['id']}.pdf"
    if not f.exists():
        try:
            req=urllib.request.Request(B+str(a["documentos"][0]["id"]),headers={"User-Agent":"radar/0.1"})
            f.write_bytes(urllib.request.urlopen(req,timeout=50).read())
        except Exception: return None
    return f
def texto(f):
    try: return re.sub(r"[ \t\n]+"," ","\n".join((p.extract_text() or "") for p in PdfReader(f).pages).lower())
    except Exception: return ""
DIM={"residencia":[r"empadronad",r"residencia",r"domiciliad",r"vecindad"],
 "ingresos/renta":[r"iprem",r"renta per c[áa]pita",r"l[íi]mite de ingresos",r"umbral de renta",r"nivel de renta"],
 "edad":[r"menores de \d+",r"mayores de \d+",r"entre \d+ y \d+ años",r"de \d+ a \d+ años"],
 "discapacidad+grado":[r"discapacidad.{0,25}\d{2}\s*%",r"grado.{0,15}discapacidad",r"igual o superior al \d{2}"],
 "familia numerosa":[r"familia numerosa"], "monoparental":[r"monoparental|monomarental"],
 "hijos/menores a cargo":[r"hijos? a cargo",r"menores a cargo",r"hijos? menores",r"descendientes a cargo"],
 "unidad familiar":[r"unidad familiar",r"unidad de convivencia"],
 "desempleo":[r"desemple",r"demandante de empleo"], "autonomo":[r"aut[óo]nomo|cuenta propia"],
 "pensionista/mayor":[r"pensionista",r"jubilad",r"tercera edad"], "dependencia":[r"depend(encia|iente)"],
 "violencia genero":[r"violencia de g[ée]nero|violencia machista"],
 "vulnerabilidad/exclusion":[r"vulnerab",r"riesgo de exclusi[óo]n",r"emergencia social"],
 "estudiante":[r"matriculad|estudiante|alumnado"], "nacionalidad/extranjeria":[r"nacionalidad",r"permiso de residencia",r"extranjer"],
 "mujer/genero":[r"\bmujer(es)?\b",r"igualdad de g[ée]nero"], "joven":[r"j[óo]venes|juventud"],
 "victima terrorismo":[r"terrorismo"], "acogimiento/tutela":[r"acogimiento|tutela|guarda"],
 "orfandad/viudedad":[r"orfandad|hu[ée]rfan|viudedad|viud[ao]"],
 "enfermedad especifica":[r"enfermedad rara|celiaqu|oncol[óo]g|salud mental|trasplant"],
 "victimas/violencia(otras)":[r"v[íi]ctima"],}
freq=collections.Counter(); leidos=0
STOP=set("de la el en y a los las que del un una para por con su sus se al como o e más más no es ser solicitante solicitantes beneficiario beneficiarios persona personas requisitos siguiente siguientes deberán deberá podrán podrá artículo apartado presente convocatoria subvención subvenciones ayuda ayudas conforme acuerdo ley real decreto cumplir reunir condiciones haber estar fecha plazo este esta estos estas según mismo cuyo cuya".split())
discovery=collections.Counter()
for a in sel:
    f=descarga(a)
    if not f: continue
    t=texto(f)
    if len(t)<200: continue
    leidos+=1
    for dim,ps in DIM.items():
        if any(re.search(p,t) for p in ps): freq[dim]+=1
    m=re.search(r"(beneficiari|requisit|podr[áa]n solicitar|destinatari)",t)
    if m:
        seg=t[m.start():m.start()+1500]
        for w in re.findall(r"[a-záéíóúñ]{5,}",seg):
            if w not in STOP: discovery[w]+=1
print(f"PLIEGOS LEÍDOS: {leidos}\n\nFRECUENCIA DE PATRONES:")
for dim,_ in DIM.items(): print(f"  {dim:28} {freq[dim]:3}/{leidos} ({round(100*freq[dim]/max(leidos,1)):3}%)")
print("\nTÉRMINOS MÁS FRECUENTES en apartados de beneficiarios/requisitos (descubrir patrones nuevos):")
for w,c in discovery.most_common(45): print(f"  {w:24} {c}")
