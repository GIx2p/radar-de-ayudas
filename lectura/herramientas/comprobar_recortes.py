"""Avisa de las citas recortadas: las que copian solo un trozo de una frase de la norma (ayuda para la regla R10).

Uso: python comprobar_recortes.py Mxx.md norma1.txt [norma2.txt ...]
- Una cita es todo lo que va entre comillas dobles en la ficha; "[…]" separa trozos.
- Solo se miran los trozos de 6 palabras o más: los términos sueltos ("persona con discapacidad") no son condiciones.
- Una frase de la norma acaba en punto, punto y coma, dos puntos o salto de línea.
- Si el trozo no empieza donde empieza su frase o no acaba donde acaba, se lista con la frase entera.
No decide nada: cada aviso se mira a mano. Si lo que falta de la frase dice a quién se aplica,
en qué caso, desde cuándo o con qué excepción, se copia la frase entera (R10). Si no cambia
nada para la familia, o ya está copiado en otro sitio de la ficha, se deja como está.
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')


def norm(s):
    return re.sub(r'\s+', ' ', s.replace(' ', ' ')).strip()


ficha = open(sys.argv[1], encoding='utf-8').read()
textos = [open(f, encoding='utf-8').read() for f in sys.argv[2:]]
# Frases de la norma: se corta por . ; : y por salto de línea.
frases = []
for t in textos:
    for linea in t.split('\n'):
        for f in re.split(r'(?<=[.;:])\s+', linea):
            f = norm(f)
            if f:
                frases.append(f)

citas = re.findall(r'"([^"]+)"', ficha)
avisos = 0
vistos = set()
for c in citas:
    for trozo in c.split('[…]'):
        t = norm(trozo).strip(' ,')
        if len(t.split()) < 6 or t in vistos:
            continue
        vistos.add(t)
        t0 = t.rstrip('.;:')
        dentro = [f for f in frases if t0 in f]
        if not dentro:
            continue  # no está en una sola frase: lo comprueba comprobar_citas.py
        # Si alguna frase coincide entera con el trozo (sin contar la letra o el número
        # del apartado, como "a)" o "1.º"), no es recorte.
        def sin_marca(f):
            return re.sub(r'^(\d+\.(º|ª)?|[a-z]\)|[a-z] bis\))\s+', '', f).rstrip('.;:')
        if any(f.rstrip('.;:') == t0 or sin_marca(f) == sin_marca(t0) for f in dentro):
            continue
        f = min(dentro, key=len)
        avisos += 1
        print(f'AVISO {avisos}: cita «{t[:120]}»')
        print(f'   frase entera: «{f[:400]}»')
print(len(vistos), 'trozos de 6 palabras o más;', avisos, 'avisos para mirar a mano')
