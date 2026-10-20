"""Comprueba las citas de un informe de revisión externa.

Uso: python comprobar_informe.py informe.txt Mxx.md norma1.txt [norma2.txt ...]

Para cada objeción numerada del informe ("1.", "2."...):
- lo citado en la línea "Norma:" debe estar, letra a letra, en alguna norma;
- lo citado en la línea "Ficha:" debe estar en la ficha.
Los espacios y saltos de línea no cuentan, ni las comillas « » " " o “ ”.
"[…]" o "(...)" dentro de una cita separa trozos que se buscan por separado.
Al final dice qué objeciones traen alguna cita que no existe.
"""
import re
import sys


def norm(s):
    s = s.replace(' ', ' ').replace('«', '').replace('»', '').replace('“', '').replace('”', '')
    s = s.replace('"', '').replace('‘', "'").replace('’', "'")
    return re.sub(r'\s+', ' ', s).strip().lower()


informe = open(sys.argv[1], encoding='utf-8').read()
ficha = norm(open(sys.argv[2], encoding='utf-8').read())
normas = norm(' '.join(open(f, encoding='utf-8').read() for f in sys.argv[3:]))

bloques = re.split(r'\n(?=\s*\d+\.\s)', '\n' + informe)
bloques = [b.strip() for b in bloques if re.match(r'\s*\d+\.\s', b)]

CITA = re.compile(r'«([^»]+)»|“([^”]+)”|"([^"]+)"')


def citas(texto):
    return [next(g for g in m.groups() if g) for m in CITA.finditer(texto)]


def comprueba(cita, donde):
    trozos = re.split(r'\[…\]|\[\.\.\.\]|\(\.\.\.\)|…', cita)
    falta = [t for t in trozos if len(norm(t).strip(' .,;:')) >= 8 and norm(t).strip(' .,;:') not in donde]
    return not falta


resumen = []
for b in bloques:
    num = re.match(r'\s*(\d+)\.', b).group(1)
    linea_norma = ' '.join(re.findall(r'Norma[^:]*:(.*?)(?=\n\s*(?:Tipo|Gravedad|Correcci|Ficha|Dónde)|\Z)', b, re.S))
    linea_ficha = ' '.join(re.findall(r'Ficha[^:]*:(.*?)(?=\n\s*(?:Norma|Tipo|Gravedad|Correcci|Dónde)|\Z)', b, re.S))
    malas = []
    for c in citas(linea_norma):
        if not comprueba(c, normas):
            malas.append(('NORMA', c))
    for c in citas(linea_ficha):
        if not comprueba(c, ficha):
            malas.append(('FICHA', c))
    sin_norma = not citas(linea_norma)
    estado = 'CITAS INVENTADAS' if malas else ('SIN CITA DE LA NORMA' if sin_norma else 'citas correctas')
    resumen.append((num, estado))
    print(f'Objeción {num}: {estado}')
    for donde, c in malas:
        print(f'   no está en la {donde.lower()}: «{c[:160]}»')

print()
print('Resumen:', ', '.join(f'{n} {e}' for n, e in resumen))
