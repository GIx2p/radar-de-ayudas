"""Comprueba que cada cita literal de una ficha está, letra a letra, en el texto de las normas.

Uso: python comprobar_citas.py Mxx.md norma1.txt [norma2.txt ...]
- Las normas se pasan como texto plano (UTF-8), sacado del BOE, del boletín o del PDF oficial.
- Una cita es todo lo que va entre comillas dobles en la ficha.
- "[…]" dentro de una cita separa trozos: cada trozo se busca por separado.
- Los espacios y saltos de línea no cuentan (el PDF los cambia).
- No se comprueban los nombres de apartados de la propia ficha (títulos y rótulos en negrita).
Sale con error si algún trozo no se encuentra.
"""
import re
import sys


def norm(s):
    return re.sub(r'\s+', ' ', s.replace(' ', ' ')).strip()


ficha = open(sys.argv[1], encoding='utf-8').read()
fuentes = norm(' '.join(open(f, encoding='utf-8').read() for f in sys.argv[2:]))

citas = re.findall(r'"([^"]+)"', ficha)
propios = {norm(x).rstrip(':') for x in
           re.findall(r'^#+ (.+)$', ficha, re.M) + re.findall(r'\*\*([^*]+?)\*\*', ficha)}
propios |= {x.split(' (')[0] for x in propios}
citas = [c for c in citas if norm(c) not in propios]

fallos = 0
for c in citas:
    for trozo in c.split('[…]'):
        t = norm(trozo).strip(' .,')
        if len(t) < 4:
            continue
        if t not in fuentes:
            fallos += 1
            print('NO ENCONTRADA:', t[:150])
print(len(citas), 'citas;', fallos, 'trozos no encontrados')
sys.exit(1 if fallos else 0)
