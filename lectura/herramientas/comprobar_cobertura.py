"""Lista las frases de una norma que no están recogidas en la ficha (ayuda para la regla R9).

Uso: python comprobar_cobertura.py Mxx.md norma.txt ["texto donde empieza" "texto donde acaba"]
- La norma se pasa como texto plano (UTF-8). Con los dos textos opcionales solo se mira ese tramo.
- La norma se corta en frases (por punto, punto y coma o dos puntos).
- Una frase cuenta como recogida si al menos el 60 % de sus trozos de 6 palabras seguidas
  están, letra a letra, en la ficha. Las frases de menos de 6 palabras no se miran.
- Los espacios, saltos de línea, caracteres de control y signos de puntuación no cuentan
  (el PDF los cambia y las citas cortan la puntuación final).
No decide nada: cada frase de la lista se mira a mano y se resuelve de una de tres formas:
va en la ficha, va en una línea de "Observaciones" o no cambia nada para la familia.
"""
import re
import sys


def norm(s):
    s = re.sub(r'[\x00-\x08\x0b-\x1f]', '', s.replace(' ', ' '))
    return re.sub(r'\s+', ' ', s).strip()


def palabras(s):
    return re.sub(r'[^\w%€/]+', ' ', s).split()


ficha = ' ' + ' '.join(palabras(norm(open(sys.argv[1], encoding='utf-8').read()))) + ' '
texto = norm(open(sys.argv[2], encoding='utf-8').read())
if len(sys.argv) > 4:
    texto = texto[texto.index(sys.argv[3]):texto.index(sys.argv[4])]

frases = re.split(r'(?<=[.;:])\s+', texto)
N = 6
pendientes = 0
for fr in frases:
    pal = palabras(fr)
    if len(pal) < N:
        continue
    trozos = [' '.join(pal[i:i + N]) for i in range(len(pal) - N + 1)]
    cob = sum(' ' + t + ' ' in ficha for t in trozos) / len(trozos)
    if cob < 0.6:
        pendientes += 1
        print(f'{cob:4.0%} | {fr}')
print(len(frases), 'frases;', pendientes, 'sin recoger en la ficha')
