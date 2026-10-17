"""Comprueba la regla R7: el segundo filtro remite a todas las filas de
"Requisitos de la norma" y a todos los apartados de "Importe, plazo y cómo se pide".

Uso: python comprobar_r7.py Mxx.md
- Filas: se buscan referencias "fila N", "filas A a B", "filas A, B y C".
- Apartados: se buscan sus nombres entre comillas ("Cómo se pide").
"""
import re
import sys

t = open(sys.argv[1], encoding='utf-8').read()


def seccion(titulo, siguiente):
    a = t.index('## ' + titulo)
    b = t.index('## ' + siguiente, a)
    return t[a:b]


req = seccion('Requisitos de la norma', 'Importe')
imp = seccion('Importe', 'Observaciones')
filas = {int(n) for n in re.findall(r'^\| (\d+) \|', req, re.M)}
apartados = [re.sub(r'[:\s]+$', '', x).strip()
             for x in re.findall(r'^- \*\*([^*]+)\*\*', imp, re.M)]

a = t.index('- **Segundo filtro**')
sf = t[a:]

citadas = set()
for m in re.finditer(r'filas? ((?:\d+(?:\s*(?:a|,|y)\s*)?)+)', sf):
    txt = m.group(1)
    for x, y in re.findall(r'(\d+)\s*a\s*(\d+)', txt):
        citadas.update(range(int(x), int(y) + 1))
    citadas.update(int(n) for n in re.findall(r'\d+', txt))

faltan_filas = sorted(filas - citadas)
faltan_apartados = [p for p in apartados if '"' + p + '"' not in sf]
sobran = sorted(citadas - filas)

print('Filas en la ficha:', len(filas), '| apartados:', len(apartados))
print('Filas que el segundo filtro no cita:', faltan_filas or 'ninguna')
print('Apartados que el segundo filtro no cita:', faltan_apartados or 'ninguno')
print('Filas citadas que no existen:', sobran or 'ninguna')
sys.exit(1 if (faltan_filas or faltan_apartados or sobran) else 0)
