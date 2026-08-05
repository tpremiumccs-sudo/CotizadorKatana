#!/usr/bin/env python3
"""
Oráculo de fidelidad: compara el PDF generado contra la huella del original.

Devuelve 0 si el documento generado es indistinguible del original dentro de las
tolerancias, y 1 con un informe legible si no.

Las tolerancias no son arbitrarias:

  · `x0` ≤ 0.75 pt  — Chromium cuantiza la posición al píxel CSS (1/96 in),
    que son exactamente 0.75 pt. Pedir menos sería pedir lo imposible.
  · `top` ≤ 1.0 pt  — además del píxel CSS, la línea base depende de las
    métricas verticales de la fuente, que redondea a entero de unidad de em.
  · tamaño ± 0.05 pt — el tamaño sí se conserva exacto; el margen es para el
    redondeo de la serialización.
  · color EXACTO    — un color distinto es un error de diseño, no de render.
  · geometría ≤ 0.5 pt — los rellenos y trazos se calculan, no se tipografían.

Uso:
    python3 tools/comparar.py GENERADO.pdf --contra tests/fixtures/honor_baseline.json
    python3 tools/comparar.py A.pdf --contra B.pdf          (compara dos PDFs)
    python3 tools/comparar.py G.pdf --contra base.json --json   (salida para tests)
"""

from __future__ import annotations

import argparse
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from huella import huella  # noqa: E402

TOL_X = 0.75
TOL_TOP = 1.0
TOL_TAM = 0.05
TOL_GEOM = 0.5
TOL_PAGINA = 0.5


class Informe:
    def __init__(self) -> None:
        self.problemas: list[dict] = []

    def fallo(self, categoria: str, pagina: int, detalle: str, **extra) -> None:
        self.problemas.append(
            {'categoria': categoria, 'pagina': pagina, 'detalle': detalle, **extra}
        )

    @property
    def ok(self) -> bool:
        return not self.problemas


def _cargar(ruta: str) -> dict:
    if ruta.endswith('.json'):
        with open(ruta, encoding='utf-8') as f:
            return json.load(f)
    return huella(ruta)


def _runs_planos(pagina: dict) -> list[dict]:
    return [r for linea in pagina['lineas'] for r in linea['runs']]


def comparar(generado: dict, esperado: dict) -> Informe:
    inf = Informe()

    # ── Número de páginas ──────────────────────────────────────────────────
    if len(generado['paginas']) != len(esperado['paginas']):
        inf.fallo(
            'paginas',
            0,
            f"El documento tiene {len(generado['paginas'])} página(s) y se esperaban "
            f"{len(esperado['paginas'])}.",
        )
        return inf

    for pg, pe in zip(generado['paginas'], esperado['paginas']):
        n = pe['numero']

        # ── Tamaño de página ───────────────────────────────────────────────
        if (
            abs(pg['ancho'] - pe['ancho']) > TOL_PAGINA
            or abs(pg['alto'] - pe['alto']) > TOL_PAGINA
        ):
            inf.fallo(
                'tamano',
                n,
                f"Tamaño {pg['ancho']}×{pg['alto']} en vez de {pe['ancho']}×{pe['alto']}.",
            )

        rg, re_ = _runs_planos(pg), _runs_planos(pe)

        # ── Secuencia de texto ─────────────────────────────────────────────
        # Se compara primero el texto solo: si sobra o falta contenido, las
        # comparaciones de posición producirían ruido inútil.
        tg = [r['texto'] for r in rg]
        te = [r['texto'] for r in re_]
        if tg != te:
            solo_esp = [t for t in te if t not in tg]
            solo_gen = [t for t in tg if t not in te]
            # Primer índice que difiere: si no falta ni sobra nada, el problema
            # es el ORDEN de los runs y hay que poder verlo.
            primero = next(
                (i for i in range(min(len(tg), len(te))) if tg[i] != te[i]), None
            )
            contexto = {}
            if primero is not None:
                contexto['indice'] = primero
                contexto['generado'] = tg[primero]
                contexto['esperado'] = te[primero]
            inf.fallo(
                'texto',
                n,
                f'La secuencia de texto no coincide ({len(tg)} runs generados, '
                f'{len(te)} esperados).',
                falta=solo_esp[:12],
                sobra=solo_gen[:12],
                **contexto,
            )
            continue

        # ── Posición, tamaño y color de cada run ───────────────────────────
        for i, (a, b) in enumerate(zip(rg, re_)):
            if abs(a['x0'] - b['x0']) > TOL_X:
                inf.fallo(
                    'posicion-x',
                    n,
                    f"Run {i} {b['texto'][:40]!r}: x0={a['x0']} y se esperaba "
                    f"{b['x0']} (Δ={a['x0'] - b['x0']:+.3f} pt, tolerancia {TOL_X}).",
                )
            if abs(a['top'] - b['top']) > TOL_TOP:
                inf.fallo(
                    'posicion-y',
                    n,
                    f"Run {i} {b['texto'][:40]!r}: top={a['top']} y se esperaba "
                    f"{b['top']} (Δ={a['top'] - b['top']:+.3f} pt, tolerancia {TOL_TOP}).",
                )
            if abs(a['tam'] - b['tam']) > TOL_TAM:
                inf.fallo(
                    'tamano-texto',
                    n,
                    f"Run {i} {b['texto'][:40]!r}: {a['tam']}pt en vez de {b['tam']}pt.",
                )
            if a['color'] != b['color']:
                inf.fallo(
                    'color',
                    n,
                    f"Run {i} {b['texto'][:40]!r}: color {a['color']} en vez de "
                    f"{b['color']}.",
                )
            if a['estilo'] != b['estilo']:
                inf.fallo(
                    'estilo',
                    n,
                    f"Run {i} {b['texto'][:40]!r}: {a['estilo']} en vez de {b['estilo']}.",
                )

        # ── Geometría ──────────────────────────────────────────────────────
        _comparar_cajas(inf, n, 'rect', pg['rects'], pe['rects'], clave='relleno')
        _comparar_filetes(inf, n, pg['trazos'], pe['trazos'])

        # ── Imágenes (el logo) ─────────────────────────────────────────────
        if len(pg['imagenes']) != len(pe['imagenes']):
            inf.fallo(
                'imagenes',
                n,
                f"{len(pg['imagenes'])} imagen(es) en vez de {len(pe['imagenes'])}.",
            )
        else:
            for i, (a, b) in enumerate(zip(pg['imagenes'], pe['imagenes'])):
                for eje in ('x0', 'top', 'x1', 'bottom'):
                    if abs(a[eje] - b[eje]) > TOL_GEOM:
                        inf.fallo(
                            'imagen-posicion',
                            n,
                            f'Imagen {i}: {eje}={a[eje]} y se esperaba {b[eje]} '
                            f'(Δ={a[eje] - b[eje]:+.3f} pt).',
                        )
    return inf


def _comparar_filetes(
    inf: Informe, pagina: int, gen: list[dict], esp: list[dict]
) -> None:
    """
    Compara filetes por su EJE y su extensión, no por su caja.

    Un filete de 0.4 pt del PDF original y el de 0.75 pt que produce Chromium
    (que no puede pintar menos de un píxel) son el mismo elemento de diseño si
    caen en la misma línea. Comparar el grosor exacto sería exigir lo imposible.
    """
    restantes = list(gen)
    for b in esp:
        candidatos = [
            g for g in restantes
            if g.get('color') == b.get('color')
            and g.get('horizontal') == b.get('horizontal')
        ]
        if not candidatos:
            inf.fallo(
                'filete', pagina,
                f"Falta un filete {b.get('color')} en el eje {b.get('eje')}.",
            )
            continue

        def desvio(g: dict) -> float:
            return max(
                abs(g['eje'] - b['eje']),
                abs(g['desde'] - b['desde']),
                abs(g['hasta'] - b['hasta']),
            )

        mejor = min(candidatos, key=desvio)
        d = desvio(mejor)
        if d > TOL_GEOM:
            orientacion = 'horizontal' if b.get('horizontal') else 'vertical'
            inf.fallo(
                'filete', pagina,
                f"Filete {orientacion} {b.get('color')} esperado en el eje "
                f"{b['eje']} de {b['desde']} a {b['hasta']}; el más cercano está "
                f"en {mejor['eje']} de {mejor['desde']} a {mejor['hasta']} "
                f"(desvío {d:.3f} pt).",
            )
        restantes.remove(mejor)

    for g in restantes:
        inf.fallo(
            'filete', pagina,
            f"Sobra un filete {g.get('color')} en el eje {g.get('eje')} "
            f"de {g.get('desde')} a {g.get('hasta')}.",
        )


def _comparar_cajas(
    inf: Informe, pagina: int, etiqueta: str, gen: list[dict], esp: list[dict], clave: str
) -> None:
    """Empareja cada caja esperada con la generada más cercana del mismo color."""
    restantes = list(gen)
    for b in esp:
        candidatos = [g for g in restantes if g.get(clave) == b.get(clave)]
        if not candidatos:
            inf.fallo(
                etiqueta,
                pagina,
                f"Falta un {etiqueta} de color {b.get(clave)} en "
                f"({b['x0']}, {b['top']})–({b['x1']}, {b['bottom']}).",
            )
            continue
        mejor = min(
            candidatos,
            key=lambda g: max(abs(g[e] - b[e]) for e in ('x0', 'top', 'x1', 'bottom')),
        )
        desvio = max(abs(mejor[e] - b[e]) for e in ('x0', 'top', 'x1', 'bottom'))
        if desvio > TOL_GEOM:
            inf.fallo(
                etiqueta,
                pagina,
                f"{etiqueta.capitalize()} {b.get(clave)} esperado en "
                f"({b['x0']}, {b['top']})–({b['x1']}, {b['bottom']}) apareció en "
                f"({mejor['x0']}, {mejor['top']})–({mejor['x1']}, {mejor['bottom']}); "
                f'desvío {desvio:.3f} pt.',
            )
        restantes.remove(mejor)

    for g in restantes:
        inf.fallo(
            etiqueta,
            pagina,
            f"Sobra un {etiqueta} de color {g.get(clave)} en "
            f"({g['x0']}, {g['top']})–({g['x1']}, {g['bottom']}).",
        )


def main() -> int:
    ap = argparse.ArgumentParser(description='Compara un PDF contra la huella esperada.')
    ap.add_argument('pdf', help='PDF generado')
    ap.add_argument('--contra', required=True, help='huella .json o PDF de referencia')
    ap.add_argument('--json', action='store_true', help='salida en JSON')
    args = ap.parse_args()

    inf = comparar(_cargar(args.pdf), _cargar(args.contra))

    if args.json:
        print(json.dumps({'ok': inf.ok, 'problemas': inf.problemas}, ensure_ascii=False))
        return 0 if inf.ok else 1

    if inf.ok:
        print('✓ El PDF generado es fiel al original dentro de las tolerancias.')
        return 0

    print(f'✗ {len(inf.problemas)} diferencia(s) respecto al original:\n')
    por_categoria: dict[str, list[dict]] = {}
    for p in inf.problemas:
        por_categoria.setdefault(p['categoria'], []).append(p)
    for cat, items in por_categoria.items():
        print(f'  [{cat}] {len(items)}')
        for it in items[:8]:
            print(f"    · pág.{it['pagina']}: {it['detalle']}")
            if it.get('falta'):
                print(f"        falta: {it['falta']}")
            if it.get('sobra'):
                print(f"        sobra: {it['sobra']}")
            if it.get('indice') is not None:
                print(f"        primer desacuerdo en el run {it['indice']}:")
                print(f"          generado: {it['generado']!r}")
                print(f"          esperado: {it['esperado']!r}")
        if len(items) > 8:
            print(f'    … y {len(items) - 8} más')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
