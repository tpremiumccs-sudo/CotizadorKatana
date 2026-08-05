#!/usr/bin/env python3
"""
Huella digital de un PDF: la representación canónica contra la que se compara.

Extrae de cada página los *runs* de texto (con posición, tamaño, estilo y color)
y la geometría vectorial (rectángulos rellenos y trazos), y lo normaliza para
que dos PDFs "iguales" produzcan huellas iguales aunque los haya generado
software distinto.

Las canonicalizaciones importan tanto como la extracción:

  · `(cid:127)` es como pdfplumber representa el glifo de viñeta del PDF
    original, que además tiene avance CERO. Se traduce a `•`.
  · Los espacios se colapsan: un generador puede emitir dos espacios donde otro
    emite uno con más avance.
  · Los caracteres contiguos con el mismo estilo se agrupan en un run, porque
    dónde parte el PDF sus operadores de texto es un detalle del generador.
  · Los nombres de fuente se reducen a Regular/Bold: `Helvetica-Bold`,
    `AAAAAA+NimbusSans-Bold` y `KatanaSans-Bold` son el mismo estilo.
  · Los trazos co-localizados se funden: un borde puede venir como cuatro
    líneas o como un rectángulo con contorno.

Uso:
    python3 tools/huella.py ENTRADA.pdf [-o SALIDA.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from typing import Any

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    sys.exit(
        'Falta pdfplumber. Instálalo con:\n'
        '  python3 -m venv .venv && .venv/bin/pip install pdfplumber'
    )

# Tolerancia para dar dos runs por pertenecientes a la misma línea visual.
#
# No basta con el píxel CSS (0.75 pt): en una misma fila conviven tamaños
# distintos —la caja de metadatos pone la etiqueta a 7.2 pt y el valor a
# 10 pt— y sus `top` difieren casi un punto ya en el documento original.
# El menor salto legítimo ENTRE líneas del documento es de 10.5 pt (las dos
# líneas del encabezado "TIKTOK + REEL / (ESPEJO)"), así que 3 pt agrupa bien
# sin fundir líneas distintas.
CUANTO_LINEA = 3.0
GROSOR_MAXIMO_FILETE = 3.2  # pt — por debajo de esto, un relleno es un filete
REDONDEO = 3             # decimales al serializar

RE_CID = re.compile(r'\(cid:(\d+)\)')

# Glifos que pdfplumber no puede mapear y su equivalente real en el documento.
CID_CONOCIDOS = {
    127: '•',  # viñeta del PDF original (avance cero + dos espacios)
}


def _hex_color(c: Any) -> str | None:
    """Normaliza el color de pdfplumber (gris, RGB o CMYK) a #RRGGBB."""
    if c is None:
        return None
    if isinstance(c, (int, float)):
        v = round(float(c) * 255)
        return '#{0:02X}{0:02X}{0:02X}'.format(max(0, min(255, v)))
    try:
        vals = list(c)
    except TypeError:
        return None
    if len(vals) == 1:
        v = round(float(vals[0]) * 255)
        return '#{0:02X}{0:02X}{0:02X}'.format(max(0, min(255, v)))
    if len(vals) == 3:
        return '#' + ''.join(
            f'{max(0, min(255, round(float(v) * 255))):02X}' for v in vals
        )
    if len(vals) == 4:  # CMYK
        cy, m, y, k = (float(v) for v in vals)
        rgb = [
            round(255 * (1 - min(1.0, cy + k))),
            round(255 * (1 - min(1.0, m + k))),
            round(255 * (1 - min(1.0, y + k))),
        ]
        return '#' + ''.join(f'{max(0, min(255, v)):02X}' for v in rgb)
    return None


def _estilo(fontname: str) -> str:
    """`AAAAAA+NimbusSans-Bold` → `Bold`. El generador no debe importar."""
    f = (fontname or '').lower()
    negrita = 'bold' in f or 'black' in f or 'heavy' in f or 'semibold' in f
    cursiva = 'italic' in f or 'oblique' in f
    if negrita and cursiva:
        return 'BoldItalic'
    if negrita:
        return 'Bold'
    if cursiva:
        return 'Italic'
    return 'Regular'


def _texto_char(ch: dict) -> str:
    t = ch.get('text', '')
    m = RE_CID.fullmatch(t)
    if m:
        return CID_CONOCIDOS.get(int(m.group(1)), '�')
    return t


def _canonizar_texto(s: str) -> str:
    """Colapsa espacios y normaliza guiones tipográficos equivalentes."""
    s = s.replace(' ', ' ').replace('‑', '-')
    return re.sub(r'\s+', ' ', s).strip()


def extraer_runs(page) -> list[dict]:
    """Agrupa los caracteres en líneas y, dentro de cada línea, en runs de estilo."""
    chars = [c for c in page.chars if _texto_char(c).strip() or c.get('text') == ' ']
    if not chars:
        return []

    # ── Agrupar por línea base ────────────────────────────────────────────
    lineas: list[list[dict]] = []
    for ch in sorted(chars, key=lambda c: (round(c['top'], 1), c['x0'])):
        colocado = False
        for grupo in lineas:
            if abs(grupo[0]['top'] - ch['top']) <= CUANTO_LINEA:
                grupo.append(ch)
                colocado = True
                break
        if not colocado:
            lineas.append([ch])

    salida: list[dict] = []
    for grupo in sorted(lineas, key=lambda g: min(c['top'] for c in g)):
        grupo.sort(key=lambda c: c['x0'])
        runs: list[dict] = []
        for ch in grupo:
            clave = (
                _estilo(ch.get('fontname', '')),
                round(float(ch.get('size', 0)), 1),
                _hex_color(ch.get('non_stroking_color')),
            )
            # Un salto horizontal grande separa dos runs aunque compartan estilo.
            # Sin esto, las cuatro celdas de precio de una fila se fundirían en
            # '$100,000$120,000$150,000$40,000' y perderíamos justo lo que hay
            # que verificar: que cada importe cae en el centro de su columna.
            salto = False
            if runs:
                anterior = runs[-1]['_chars'][-1]
                hueco = float(ch['x0']) - float(anterior['x1'])
                umbral = max(1.5, 0.5 * float(ch.get('size', 0) or 0))
                salto = hueco > umbral

            if runs and runs[-1]['_clave'] == clave and not salto:
                runs[-1]['_chars'].append(ch)
            else:
                runs.append({'_clave': clave, '_chars': [ch]})

        limpio = []
        for r in runs:
            texto = _canonizar_texto(''.join(_texto_char(c) for c in r['_chars']))
            if not texto:
                continue
            cs = r['_chars']
            estilo, tam, color = r['_clave']
            limpio.append(
                {
                    'texto': texto,
                    'x0': round(min(c['x0'] for c in cs), REDONDEO),
                    'x1': round(max(c['x1'] for c in cs), REDONDEO),
                    'top': round(min(c['top'] for c in cs), REDONDEO),
                    'tam': tam,
                    'estilo': estilo,
                    'color': color,
                }
            )
        if limpio:
            salida.append(
                {'top': round(min(r['top'] for r in limpio), REDONDEO), 'runs': limpio}
            )
    return salida


def extraer_geometria(page) -> dict:
    """
    Cajas de tinta: rectángulos rellenos y trazos.

    Un trazo de grosor L centrado en x se pinta como una banda de L de ancho, así
    que se convierte a su caja real. Eso hace comparables un `border-left: 3pt`
    de CSS y un trazo de lw=3 del PDF original.
    """
    rects: list[dict] = []
    trazos: list[dict] = []

    for r in page.rects:
        caja = {
            'x0': round(r['x0'], REDONDEO),
            'top': round(r['top'], REDONDEO),
            'x1': round(r['x1'], REDONDEO),
            'bottom': round(r['bottom'], REDONDEO),
        }
        if r.get('fill'):
            color = _hex_color(r.get('non_stroking_color'))
            # El rectángulo blanco de fondo de página no es información.
            if color == '#FFFFFF' and caja['x0'] <= 0.5 and caja['top'] <= 0.5:
                continue
            ancho = caja['x1'] - caja['x0']
            alto = caja['bottom'] - caja['top']
            if min(ancho, alto) <= GROSOR_MAXIMO_FILETE:
                # Filete: se clasifica como trazo para poder compararlo con el
                # `stroke` equivalente del PDF original.
                trazos.append({
                    **caja,
                    'color': color,
                    'grosor': round(min(ancho, alto), 2),
                    'forma': 'filete',
                })
            else:
                rects.append({**caja, 'relleno': color})
        if r.get('stroke'):
            trazos.append(
                {
                    **caja,
                    'color': _hex_color(r.get('stroking_color')),
                    'grosor': round(float(r.get('linewidth') or 0), 2),
                    'forma': 'rect',
                }
            )

    for ln in page.lines:
        lw = float(ln.get('linewidth') or 0) or 0.5
        x0, x1 = sorted((ln['x0'], ln['x1']))
        top, bottom = sorted((ln['top'], ln['bottom']))
        if abs(bottom - top) < abs(x1 - x0):     # horizontal
            top, bottom = top - lw / 2, top + lw / 2
        else:                                     # vertical
            x0, x1 = x0 - lw / 2, x0 + lw / 2
        trazos.append(
            {
                'x0': round(x0, REDONDEO),
                'top': round(top, REDONDEO),
                'x1': round(x1, REDONDEO),
                'bottom': round(bottom, REDONDEO),
                'color': _hex_color(ln.get('stroking_color')),
                'grosor': round(lw, 2),
                'forma': 'linea',
            }
        )

    # Fusionar trazos co-localizados. Un borde puede venir como cuatro líneas o
    # como un rectángulo con contorno; y el mismo filete puede estar dibujado
    # dos veces con grosores distintos. Se identifican por su EJE (el centro de
    # la banda) y su extensión, que es lo que se ve.
    vistos: dict[tuple, dict] = {}
    for t in trazos:
        ancho = t['x1'] - t['x0']
        alto = t['bottom'] - t['top']
        horizontal = ancho >= alto
        eje = (t['top'] + t['bottom']) / 2 if horizontal else (t['x0'] + t['x1']) / 2
        t['eje'] = round(eje, 3)
        t['horizontal'] = horizontal
        t['desde'] = round(t['x0'] if horizontal else t['top'], 3)
        t['hasta'] = round(t['x1'] if horizontal else t['bottom'], 3)
        clave = (
            horizontal,
            round(eje, 1),
            round(t['desde'], 0),
            round(t['hasta'], 0),
            t['color'],
        )
        vistos.setdefault(clave, t)

    return {
        'rects': sorted(rects, key=lambda r: (r['top'], r['x0'])),
        'trazos': sorted(vistos.values(), key=lambda t: (t['top'], t['x0'])),
    }


def extraer_imagenes(page) -> list[dict]:
    return sorted(
        (
            {
                'x0': round(im['x0'], REDONDEO),
                'top': round(im['top'], REDONDEO),
                'x1': round(im['x1'], REDONDEO),
                'bottom': round(im['bottom'], REDONDEO),
            }
            for im in page.images
        ),
        key=lambda i: (i['top'], i['x0']),
    )


def huella(ruta: str) -> dict:
    with pdfplumber.open(ruta) as pdf:
        paginas = []
        for i, page in enumerate(pdf.pages):
            paginas.append(
                {
                    'numero': i + 1,
                    'ancho': round(float(page.width), REDONDEO),
                    'alto': round(float(page.height), REDONDEO),
                    'lineas': extraer_runs(page),
                    **extraer_geometria(page),
                    'imagenes': extraer_imagenes(page),
                }
            )
    return {'version': 1, 'paginas': paginas}


def main() -> int:
    ap = argparse.ArgumentParser(description='Genera la huella canónica de un PDF.')
    ap.add_argument('pdf', help='PDF de entrada')
    ap.add_argument('-o', '--salida', help='JSON de salida (por omisión, stdout)')
    args = ap.parse_args()

    h = huella(args.pdf)
    texto = json.dumps(h, ensure_ascii=False, indent=2, sort_keys=False)

    if args.salida:
        with open(args.salida, 'w', encoding='utf-8') as f:
            f.write(texto + '\n')
        n_runs = sum(len(l['runs']) for p in h['paginas'] for l in p['lineas'])
        print(
            f'Huella escrita en {args.salida}: '
            f"{len(h['paginas'])} página(s), {n_runs} runs de texto."
        )
    else:
        print(texto)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
