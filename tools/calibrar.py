#!/usr/bin/env python3
"""
Calibración tipográfica: deriva las constantes del documento MIDIENDO.

Produce dos artefactos que consume el generador del documento:

  · `src/lib/doc/anchos.json` — tabla de anchos de avance por carácter, en
    unidades de 1/1000 em, para Regular y Bold. Con ella el paginador calcula
    el ancho de cualquier cadena sin tocar el DOM, de forma idéntica en el
    servidor y en el navegador.

  · `src/lib/doc/metricas.json` — desfase de la línea base por (estilo, tamaño):
    cuánto hay que restar a la coordenada `top` medida en el PDF para obtener
    el `top` de CSS que la reproduce.

Y comprueba tres invariantes. Si alguna falla, la fidelidad es imposible y más
vale saberlo aquí que tres fases después:

  1. Los anchos de la fuente embebida son los de Helvetica (es un clon métrico).
  2. Chromium respeta esos anchos al maquetar — es decir, no hay kerning ni
     ligaduras activas que desvíen el avance.
  3. El desfase de línea base es estable: cambiar la posición de un bloque no
     lo mueve más de un píxel CSS (0.75 pt), que es la tolerancia del oráculo.

Uso:
    python3 tools/calibrar.py                escribe los dos JSON
    python3 tools/calibrar.py --verificar    solo comprueba
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))

from huella import huella  # noqa: E402

try:
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover
    sys.exit('Falta fontTools: .venv/bin/pip install fonttools brotli')

FUENTES = {
    'Regular': os.path.join(RAIZ, 'assets/fonts/KatanaSans-Regular.woff2'),
    'Bold': os.path.join(RAIZ, 'assets/fonts/KatanaSans-Bold.woff2'),
}
SALIDA_ANCHOS = os.path.join(RAIZ, 'src/lib/doc/anchos.json')
SALIDA_METRICAS = os.path.join(RAIZ, 'src/lib/doc/metricas.json')

# Combinaciones (estilo, tamaño) que usa el Tabulador de HONOR, medidas del PDF.
SONDAS = [
    ('Bold', 19.0), ('Bold', 13.5), ('Bold', 10.0), ('Bold', 9.7),
    ('Bold', 9.6), ('Bold', 9.0), ('Bold', 8.3), ('Bold', 8.2),
    ('Bold', 7.2),
    ('Regular', 9.0), ('Regular', 8.2), ('Regular', 7.6), ('Regular', 7.0),
]

# Cadenas reales del documento: si Chromium las mide como la tabla, cualquier
# otra cadena también.
CONTROLES = [
    ('Bold', 19.0, 'Tabulador de Tarifas'),
    ('Bold', 9.7, 'Mariel Estrella'),
    ('Bold', 9.6, '$100,000'),
    ('Bold', 8.3, 'TIKTOK + REEL'),
    ('Bold', 13.5, 'Términos y Condiciones'),
    ('Regular', 9.0, 'No incluyen pauta digital (whitelisting).'),
    ('Regular', 7.0, 'Katana Talent · Información confidencial'),
    ('Regular', 7.6, 'Representación · Influencer Marketing'),
]

# Desplazamientos sub-píxel para comprobar la estabilidad del desfase.
DESPLAZAMIENTOS = [0.0, 0.13, 0.27, 0.41, 0.55, 0.68]

# Chromium emite correcciones sub-punto en el array TJ, así que su ancho
# maquetado no es exactamente la suma de avances de la tabla. Lo que debe
# cumplirse es que el error acumulado en una línea entera quede muy por debajo
# de la tolerancia del oráculo para `x0` (0.75 pt) y sea despreciable frente a
# la longitud del texto — sólo así las decisiones de corte de línea coinciden.
TOL_ANCHO = 0.25        # pt, error absoluto en una cadena completa
TOL_ANCHO_REL = 0.005   # 0.5 % de la longitud de la cadena
TOL_DISPERSION = 0.75   # pt — un píxel CSS

# Anchos canónicos de Helvetica (AFM de Adobe) para una muestra de control.
# Si el subset dejara de ser un clon métrico, esto lo delata.
HELVETICA_AFM = {
    'Regular': {' ': 278, 'A': 667, 'N': 722, 'T': 611, 'a': 556, 'c': 500,
                'e': 556, 'i': 222, 'l': 222, 'n': 556, 'o': 556, 'u': 556,
                'y': 500, '.': 278, '0': 556, '1': 556, '$': 556, ',': 278},
    'Bold': {' ': 278, 'A': 722, 'E': 667, 'M': 833, 'T': 611, 'a': 556,
             'e': 556, 'i': 278, 'l': 278, 'o': 611, 's': 556, 't': 333,
             'u': 611, '.': 278, '0': 556, '1': 556, '$': 556, ',': 278},
}


def tabla_anchos(ruta: str) -> dict[str, float]:
    f = TTFont(ruta)
    upm = f['head'].unitsPerEm
    hmtx = f['hmtx'].metrics
    cmap = f.getBestCmap()
    salida: dict[str, float] = {}
    for cp, glifo in cmap.items():
        if cp < 0x2500 and glifo in hmtx:
            salida[chr(cp)] = round(hmtx[glifo][0] * 1000.0 / upm, 4)
    return salida


def ancho_cadena(tabla: dict[str, float], texto: str, tam: float) -> float:
    fallback = tabla.get('?', 556.0)
    return sum(tabla.get(c, fallback) for c in texto) * tam / 1000.0


def _data_uri(ruta: str) -> str:
    with open(ruta, 'rb') as f:
        return 'data:font/woff2;base64,' + base64.b64encode(f.read()).decode('ascii')


def css_base() -> str:
    """
    CSS del documento. Cada declaración está aquí por una razón concreta:

      · `@page size: 8.5in 11in; margin: 0` — el tamaño lo manda el CSS y
        Playwright lo respeta con `preferCSSPageSize`.
      · `font-kerning: none` + `font-variant-ligatures: none` — el PDF original
        se generó sin kerning. Con kerning activo los avances se desvían y las
        posiciones dejan de cuadrar.
      · `text-rendering: geometricPrecision` — evita que Chromium redondee el
        avance acumulado al píxel.
      · Fuentes embebidas como data: URI — el documento se basta a sí mismo y
        se ve igual en el servidor y en el iPad.
    """
    return f"""
@font-face {{
  font-family: 'KatanaSans';
  src: url('{_data_uri(FUENTES["Regular"])}') format('woff2');
  font-weight: 400; font-style: normal; font-display: block;
}}
@font-face {{
  font-family: 'KatanaSans';
  src: url('{_data_uri(FUENTES["Bold"])}') format('woff2');
  font-weight: 700; font-style: normal; font-display: block;
}}
@page {{ size: 8.5in 11in; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: #fff; }}
* {{ box-sizing: border-box; }}
body {{
  font-family: 'KatanaSans';
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: 'kern' 0, 'liga' 0, 'clig' 0, 'calt' 0;
  text-rendering: geometricPrecision;
}}
.s {{ position: absolute; left: 0; white-space: pre; line-height: 1; color: #000; }}
.pagina {{ position: relative; width: 612pt; height: 792pt; overflow: hidden; break-after: page; }}
.pagina:last-child {{ break-after: auto; }}
"""


def _render(piezas: list[str]) -> dict:
    html = (
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><style>'
        + css_base()
        + '</style></head><body>'
        + ''.join(piezas)
        + '</body></html>'
    )
    tmp = tempfile.mkdtemp(prefix='katana-calib-')
    hp, pp = os.path.join(tmp, 'p.html'), os.path.join(tmp, 'p.pdf')
    with open(hp, 'w', encoding='utf-8') as f:
        f.write(html)
    r = subprocess.run(
        ['node', os.path.join(RAIZ, 'tools/render-html.mjs'), hp, pp],
        capture_output=True, text=True, cwd=RAIZ,
    )
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr, file=sys.stderr)
        raise SystemExit('No se pudo renderizar la página de sondas.')
    return huella(pp)


def _runs_en_orden(h: dict) -> list[dict]:
    """Todos los runs del documento, en orden de lectura (página, luego top)."""
    salida: list[dict] = []
    for pagina in h['paginas']:
        de_pagina = [r for l in pagina['lineas'] for r in l['runs']]
        salida.extend(sorted(de_pagina, key=lambda r: (r['top'], r['x0'])))
    return salida


def _div(top: float, estilo: str, tam: float, texto: str) -> str:
    peso = 700 if estilo == 'Bold' else 400
    return (
        f'<div class="s" style="top:{top}pt;font-size:{tam}pt;'
        f'font-weight:{peso}">{texto}</div>'
    )


def main() -> int:
    ap = argparse.ArgumentParser(description='Calibra las métricas del documento.')
    ap.add_argument('--verificar', action='store_true')
    args = ap.parse_args()

    for ruta in FUENTES.values():
        if not os.path.exists(ruta):
            raise SystemExit(f'Falta la fuente {ruta}. Genera los subsets primero.')

    anchos = {estilo: tabla_anchos(ruta) for estilo, ruta in FUENTES.items()}
    problemas: list[str] = []

    # ── 1. La fuente sigue siendo un clon métrico de Helvetica ─────────────
    print('1) Anchos de la fuente frente a la AFM de Helvetica')
    desviados = 0
    total = 0
    for estilo, esperado in HELVETICA_AFM.items():
        for ch, val in esperado.items():
            total += 1
            got = anchos[estilo].get(ch)
            if got is None or abs(got - val) > 0.51:
                desviados += 1
                problemas.append(
                    f'{estilo} {ch!r}: ancho {got} y Helvetica dice {val}.'
                )
    print(f'   {total} glifos comparados · {desviados} desviados')

    # ── 2. Chromium respeta esos anchos ────────────────────────────────────
    print('\n2) Anchos que Chromium produce frente a la tabla')
    # Una hoja por control: sin flujo entre páginas, cada sonda está donde se
    # la puso y el orden de lectura es inequívoco.
    piezas, filas = [], []
    for estilo, tam, texto in CONTROLES:
        piezas.append('<div class="pagina">' + _div(60.0, estilo, tam, texto) + '</div>')
        filas.append((estilo, tam, texto, 60.0))

    runs = _runs_en_orden(_render(piezas))
    if len(runs) != len(filas):
        raise SystemExit(f'Se esperaban {len(filas)} controles y se midieron {len(runs)}.')

    for (estilo, tam, texto, _), run in zip(filas, runs):
        medido = run['x1'] - run['x0']
        calc = ancho_cadena(anchos[estilo], texto, tam)
        delta = medido - calc
        ok = abs(delta) <= TOL_ANCHO and abs(delta) <= TOL_ANCHO_REL * max(calc, 1.0)
        print(
            f'   {estilo:8s} {tam:5.1f}pt  medido={medido:8.3f} tabla={calc:8.3f} '
            f'Δ={delta:+.4f} ({100 * delta / max(calc, 1.0):+.3f}%)  '
            f'{"OK" if ok else "DIFIERE"}   {texto[:32]!r}'
        )
        if not ok:
            problemas.append(
                f'Chromium mide {texto[:30]!r} a {tam}pt con {delta:+.4f} pt de '
                'diferencia respecto a la tabla de anchos.'
            )

    # ── 3. Desfase de línea base y su estabilidad ──────────────────────────
    print('\n3) Desfase de la línea base (top del PDF − top del CSS)')
    # Una hoja por combinación (estilo, tamaño), con las seis posiciones de
    # prueba bien separadas dentro de ella.
    piezas, filas = [], []
    for estilo, tam in SONDAS:
        sondas_pagina = []
        y = 60.0
        for d in DESPLAZAMIENTOS:
            top = round(y + d, 3)
            sondas_pagina.append(_div(top, estilo, tam, 'Hxdmg'))
            filas.append((estilo, tam, top, top))
            y += 110.0
        piezas.append('<div class="pagina">' + ''.join(sondas_pagina) + '</div>')

    runs = _runs_en_orden(_render(piezas))
    if len(runs) != len(filas):
        raise SystemExit(f'Se esperaban {len(filas)} sondas y se midieron {len(runs)}.')

    desfases: dict[str, float] = {}
    peor_dispersion = 0.0
    n = len(DESPLAZAMIENTOS)
    for i in range(0, len(filas), n):
        estilo, tam, _, _ = filas[i]
        offs = [runs[i + j]['top'] - filas[i + j][3] for j in range(n)]
        dispersion = max(offs) - min(offs)
        peor_dispersion = max(peor_dispersion, dispersion)
        # Se guarda el desfase del desplazamiento 0, que es el caso canónico.
        desfases[f'{estilo}@{tam}'] = round(offs[0], 4)
        print(
            f'   {estilo:8s} {tam:5.1f}pt  desfase={offs[0]:+8.3f} pt  '
            f'dispersión={dispersion:.3f} pt'
        )

    print(
        f'\n   Dispersión máxima: {peor_dispersion:.3f} pt '
        f'(un píxel CSS = 0.75 pt; tolerancia del oráculo para `top` = 1.0 pt)'
    )
    if peor_dispersion > TOL_DISPERSION:
        problemas.append(
            f'El desfase de línea base varía {peor_dispersion:.3f} pt según la '
            'posición, más de un píxel CSS.'
        )

    # ── Resultado ──────────────────────────────────────────────────────────
    if problemas:
        print(f'\n✗ {len(problemas)} problema(s) de calibración:')
        for p in problemas[:15]:
            print(f'   · {p}')
        return 1

    print(
        '\n✓ Calibración correcta: la fuente embebida es un clon métrico de '
        'Helvetica, Chromium respeta sus anchos y el desfase de línea base es '
        'estable dentro de un píxel CSS.'
    )

    if not args.verificar:
        os.makedirs(os.path.dirname(SALIDA_ANCHOS), exist_ok=True)
        with open(SALIDA_ANCHOS, 'w', encoding='utf-8') as f:
            json.dump(
                {
                    '_comentario': (
                        'GENERADO por tools/calibrar.py. No editar a mano. '
                        'Anchos de avance en 1/1000 em, extraídos de las fuentes '
                        'de assets/fonts/. El paginador los usa para medir texto '
                        'sin tocar el DOM.'
                    ),
                    'unidadesPorEm': 1000,
                    'anchos': anchos,
                },
                f, ensure_ascii=False, indent=2, sort_keys=True,
            )
        with open(SALIDA_METRICAS, 'w', encoding='utf-8') as f:
            json.dump(
                {
                    '_comentario': (
                        'GENERADO por tools/calibrar.py. No editar a mano. '
                        'desfaseLineaBase[estilo@tamaño] = top medido en el PDF '
                        'menos el top de CSS, con line-height:1. Para reproducir '
                        'una coordenada del original: cssTop = topDelPDF − desfase.'
                    ),
                    'dispersionMaximaPt': round(peor_dispersion, 4),
                    'desfaseLineaBase': desfases,
                },
                f, ensure_ascii=False, indent=2, sort_keys=True,
            )
        print(f'   {os.path.relpath(SALIDA_ANCHOS, RAIZ)}')
        print(f'   {os.path.relpath(SALIDA_METRICAS, RAIZ)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
