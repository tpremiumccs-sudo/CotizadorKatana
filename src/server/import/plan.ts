import type {
  PlanImportacion,
  EntradaPlanTalento,
  Incidencia,
  RejillaHoja,
  DeteccionEncabezado,
  MetricaPlaneada,
  ResumenPlan,
  Severidad,
  ValorCelda,
} from './types'
import { detectHeaderRow, indicePorCanonico, esFilaCentinela } from './header'
import { parsePrice } from './parse-price'
import { parseFollowerCount } from './parse-metric'
import {
  resolveIdentity, normalizeName, extractVariants, type TalentoConocido,
} from './identity'
import { FORMATOS } from './catalogo'
import { buscarHoja } from './workbook'
import {
  SPEC_TARIFARIO, SPEC_PERFIL, SPEC_TALENTOS, SPEC_ROSTER_BASE, SPEC_KIF,
} from './spec'

/**
 * Construye el PLAN de importación: qué cambiaría si se aplicara.
 *
 * Es una función PURA — recibe las rejillas ya leídas y el estado actual, y no
 * toca la base. Así se puede enseñar al usuario lo que va a pasar antes de que
 * pase, y se puede probar contra los archivos reales sin montar Postgres.
 *
 * Tres principios, los tres aprendidos de los datos reales:
 *
 *   · Nada se descarta en silencio. Las 19 filas huérfanas de la hoja TALENTOS
 *     tienen datos de verdad — incluida una con precios en columnas sin
 *     encabezado — y se reportan con su volcado crudo.
 *   · Nada se fusiona sin permiso. Sólo la coincidencia exacta es automática.
 *   · Nada se borra. Un talento que el archivo no traiga se marca como ausente,
 *     nunca se elimina: el archivo puede estar incompleto.
 */

export interface TarifaActual {
  talentId: string
  deliverableCode: string
  amountCents: number | null
  priceStatus: string
  /** Se editó a mano en la app: un archivo viejo no debe pisarlo. */
  editadaAMano: boolean
}

export interface ContextoPlan {
  talentosConocidos: readonly TalentoConocido[]
  tarifasActuales: readonly TarifaActual[]
  /** Nombre del archivo, para el informe. */
  archivo: string
  sha256: string
}

const PLATAFORMAS_ROSTER: Array<{ header: string; plataforma: string }> = [
  { header: 'Instagram', plataforma: 'INSTAGRAM' },
  { header: 'TikTok', plataforma: 'TIKTOK' },
  { header: 'YouTube', plataforma: 'YOUTUBE' },
  { header: 'Facebook', plataforma: 'FACEBOOK' },
  { header: 'Twitch', plataforma: 'TWITCH' },
  { header: 'Kick', plataforma: 'KICK' },
]

const PLATAFORMAS_TALENTOS: Array<{ header: string; plataforma: string }> = [
  { header: 'IG seguidores', plataforma: 'INSTAGRAM' },
  { header: 'TikTok seguidores', plataforma: 'TIKTOK' },
  { header: 'YouTube subs', plataforma: 'YOUTUBE' },
]

function texto(v: ValorCelda): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

function filaTieneDatos(fila: ValorCelda[]): boolean {
  return fila.some((c) => texto(c) !== '')
}

/**
 * Detecta filas con datos pero sin nombre de talento.
 *
 * En la hoja TALENTOS del archivo real hay 19. No son ruido: llevan notas
 * comerciales y, en un caso, precios sueltos en columnas sin encabezado. Se
 * reportan con su contenido para que un humano decida a quién pertenecen.
 */
function detectarHuerfanas(
  hoja: RejillaHoja,
  d: DeteccionEncabezado,
  colNombre: number,
): Incidencia[] {
  const out: Incidencia[] = []
  for (let i = d.filaPrimerDato; i < hoja.filas.length; i++) {
    const fila = hoja.filas[i]!
    if (texto(fila[colNombre]) !== '') continue
    if (!filaTieneDatos(fila)) continue
    if (esFilaCentinela(fila)) continue

    const conDatos = fila
      .map((c, j) => ({ j, v: texto(c) }))
      .filter((x) => x.v !== '')

    const enBandaSinEncabezado = conDatos.some((x) =>
      d.columnasSinEncabezado.includes(x.j),
    )

    out.push({
      codigo: enBandaSinEncabezado ? 'BANDA_COLUMNAS_DESPLAZADA' : 'FILA_HUERFANA',
      severidad: 'AVISO',
      hoja: hoja.nombre,
      fila: i,
      mensaje: enBandaSinEncabezado
        ? `La fila ${i + 1} tiene datos en columnas sin encabezado y no dice a qué ` +
          'talento pertenece. Asígnala manualmente o ignórala.'
        : `La fila ${i + 1} tiene datos pero la columna de talento está vacía. ` +
          'Probablemente es una nota que se desalineó al pegar.',
      crudo: Object.fromEntries(conDatos.map((x) => [`col${x.j}`, x.v])),
    })
  }
  return out
}

export function buildImportPlan(
  hojas: readonly RejillaHoja[],
  tipo: 'CRM_COMERCIAL' | 'ROSTER',
  ctx: ContextoPlan,
): PlanImportacion {
  const incidencias: Incidencia[] = []
  const hojasDetectadas: Array<{ hoja: string; deteccion: DeteccionEncabezado }> = []
  const porNormalizado = new Map<string, EntradaPlanTalento>()

  const tarifasPorClave = new Map<string, TarifaActual>()
  for (const t of ctx.tarifasActuales) {
    tarifasPorClave.set(`${t.talentId}|${t.deliverableCode}`, t)
  }

  /**
   * Devuelve (o crea) la entrada del talento, resolviendo su identidad.
   *
   * La clave NO es el nombre normalizado sino la identidad resuelta. Dentro de
   * un mismo archivo el mismo talento aparece escrito distinto según la hoja:
   * PERFIL COMERCIAL lo llama "Kike Padilla" y TARIFARIO "Kike Padilla /
   * Rookie Leagues". Con la clave por nombre se creaban dos entradas y las
   * tarifas quedaban colgando de la que no era.
   */
  function entrada(crudo: string): EntradaPlanTalento {
    const normalizado = normalizeName(crudo)
    const existente = porNormalizado.get(normalizado)
    if (existente) return existente

    // Alias explícito dentro del propio archivo: la hoja TALENTOS dice
    // "Padigol / Santiago Padilla" donde TARIFARIO dice "Padigol", y
    // "Ronny (Ronaldo López)" donde otra dice "Ronny". La barra y el paréntesis
    // son marcas de alias, así que si una de las variantes ya tiene entrada,
    // es el mismo talento y se reutiliza en vez de duplicarlo.
    const variantes = extractVariants(crudo)
    for (const v of variantes) {
      const porVariante = porNormalizado.get(v)
      if (porVariante) {
        porNormalizado.set(normalizado, porVariante)
        return porVariante
      }
    }

    const identidad = resolveIdentity(crudo, ctx.talentosConocidos)

    // Si esta identidad ya tiene entrada bajo otra grafía, se reutiliza.
    if (identidad.decision === 'COINCIDENCIA_EXACTA' && identidad.mejor) {
      for (const e of porNormalizado.values()) {
        if (e.talentIdExistente === identidad.mejor.talentId) {
          porNormalizado.set(normalizado, e)
          return e
        }
      }
    }

    const auto = identidad.decision === 'COINCIDENCIA_EXACTA'
    const e: EntradaPlanTalento = {
      crudo,
      normalizado,
      accion: auto ? 'SIN_CAMBIOS' : 'CREAR',
      talentIdExistente: auto ? (identidad.mejor?.talentId ?? null) : null,
      codigo: auto ? (identidad.mejor?.codigo ?? null) : null,
      displayName: auto ? (identidad.mejor?.displayName ?? crudo) : crudo,
      identidad: auto ? undefined : identidad,
      cambiosTalento: {},
      cambiosTarifas: [],
      metricas: [],
      incidencias: [],
    }
    if (identidad.decision === 'REQUIERE_REVISION') {
      e.incidencias.push({
        codigo: 'IDENTIDAD_AMBIGUA',
        severidad: 'AVISO',
        hoja: '(identidad)',
        mensaje: identidad.motivo,
        crudo: { candidatos: identidad.alternativas.map((a) => a.displayName) },
      })
    }
    porNormalizado.set(normalizado, e)
    // También se indexa por las otras grafías conocidas de esta identidad, para
    // que la siguiente hoja del mismo archivo caiga en esta misma entrada.
    if (identidad.mejor) {
      for (const alias of [identidad.mejor.displayName, identidad.mejor.canonicalName]) {
        const n = normalizeName(alias)
        if (n && !porNormalizado.has(n)) porNormalizado.set(n, e)
      }
    }
    return e
  }

  /** Registra una grafía adicional que apunta a una entrada ya creada. */
  function indexarAlias(e: EntradaPlanTalento, nombre: string): void {
    const n = normalizeName(nombre)
    if (n && !porNormalizado.has(n)) porNormalizado.set(n, e)
  }

  // ═══════════════════ CRM COMERCIAL ═══════════════════
  if (tipo === 'CRM_COMERCIAL') {
    // ── Perfil comercial: da el código canónico KT-XXX ────────────────────
    const hPerfil = buscarHoja(hojas, SPEC_PERFIL.hoja)
    if (hPerfil) {
      const d = detectHeaderRow(hPerfil, SPEC_PERFIL)
      hojasDetectadas.push({ hoja: hPerfil.nombre, deteccion: d })
      const idx = indicePorCanonico(d)
      const cId = idx.get('talent_id')
      const cCanon = idx.get('canonical_name')
      const cDisplay = idx.get('display_name')

      if (cId != null && cCanon != null) {
        for (let i = d.filaPrimerDato; i < hPerfil.filas.length; i++) {
          const fila = hPerfil.filas[i]!
          const codigo = texto(fila[cId])
          const canon = texto(fila[cCanon])
          if (!codigo || !canon || esFilaCentinela(fila)) continue

          const e = entrada(canon)
          e.codigo ??= codigo
          const display = cDisplay != null ? texto(fila[cDisplay]) : ''
          if (display) {
            e.displayName = display
            // "Kike Padilla" en PERFIL es "Kike Padilla / Rookie Leagues" en
            // TARIFARIO: se indexan ambas para no duplicar la entrada.
            indexarAlias(e, display)
          }
          asignar(e, 'code', codigo)
          asignar(e, 'canonicalName', canon)
          const cBio = idx.get('Biografía breve')
          if (cBio != null && texto(fila[cBio])) asignar(e, 'bio', texto(fila[cBio]))
          const cDrive = idx.get('library_folder_id')
          if (cDrive != null && texto(fila[cDrive])) {
            asignar(e, 'driveFolderId', texto(fila[cDrive]))
          }
        }
      }
    } else {
      incidencias.push(hojaFaltante(SPEC_PERFIL.hoja))
    }

    // ── Tarifario: la fuente de precios ──────────────────────────────────
    const hTar = buscarHoja(hojas, SPEC_TARIFARIO.hoja)
    if (!hTar) {
      incidencias.push(hojaFaltante(SPEC_TARIFARIO.hoja, 'ERROR'))
    } else {
      const d = detectHeaderRow(hTar, SPEC_TARIFARIO)
      hojasDetectadas.push({ hoja: hTar.nombre, deteccion: d })
      const idx = indicePorCanonico(d)
      const cNombre = idx.get('Talento')

      if (cNombre == null || d.requiereMapeoManual) {
        incidencias.push({
          codigo: 'ENCABEZADO_NO_DETECTADO',
          severidad: 'ERROR',
          hoja: hTar.nombre,
          mensaje:
            `No se reconocieron los encabezados de ${hTar.nombre} ` +
            `(confianza ${(d.confianza * 100).toFixed(0)} %). Faltan: ` +
            d.requeridosFaltantes.join(', '),
        })
      } else {
        incidencias.push(...detectarHuerfanas(hTar, d, cNombre))

        for (let i = d.filaPrimerDato; i < hTar.filas.length; i++) {
          const fila = hTar.filas[i]!
          const nombre = texto(fila[cNombre])
          if (!nombre || esFilaCentinela(fila)) continue

          const e = entrada(nombre)

          // Campos que no son formatos cotizables.
          for (const [header, campo] of [
            ['Plataforma principal', 'primaryPlatformNote'],
            ['Estado', 'rateStatusRaw'],
            ['Notas', 'rateNotes'],
            ['Fuente / fecha', 'rateSourceLabel'],
          ] as const) {
            const c = idx.get(header)
            if (c != null && texto(fila[c])) asignar(e, campo, texto(fila[c]))
          }

          for (const f of FORMATOS) {
            const c = idx.get(f.excelHeader)
            if (c == null) continue
            const p = parsePrice(fila[c])

            if (!p.ok || !p.status) {
              e.incidencias.push({
                codigo: 'PRECIO_NO_RECONOCIDO',
                severidad: 'AVISO',
                hoja: hTar.nombre,
                fila: i,
                columna: c,
                mensaje: `${nombre} · ${f.name}: ${p.aviso?.mensaje ?? 'valor ilegible'}`,
                crudo: p.crudo,
              })
              continue
            }
            if (p.aviso?.codigo === 'MAGNITUD_SOSPECHOSA') {
              e.incidencias.push({
                codigo: 'PRECIO_SOSPECHOSO',
                severidad: 'AVISO',
                hoja: hTar.nombre,
                fila: i,
                columna: c,
                mensaje: `${nombre} · ${f.name}: ${p.aviso.mensaje}`,
                crudo: p.crudo,
              })
            }

            const actual = e.talentIdExistente
              ? tarifasPorClave.get(`${e.talentIdExistente}|${f.code}`)
              : undefined

            const igual =
              actual &&
              actual.amountCents === p.amountCents &&
              actual.priceStatus === p.status
            if (igual) continue

            e.cambiosTarifas.push({
              deliverableCode: f.code,
              deliverableNombre: f.name,
              antesAmountCents: actual?.amountCents ?? null,
              antesPriceStatus: actual?.priceStatus ?? null,
              despuesAmountCents: p.amountCents,
              despuesPriceStatus: p.status,
              conflicto: Boolean(actual?.editadaAMano),
              resolucion: actual?.editadaAMano ? 'CONSERVAR_APP' : undefined,
            })
          }
        }
      }
    }

    // ── Hoja TALENTOS: categoría, verticales y métricas ──────────────────
    const hTal = buscarHoja(hojas, SPEC_TALENTOS.hoja)
    if (hTal) {
      const d = detectHeaderRow(hTal, SPEC_TALENTOS)
      hojasDetectadas.push({ hoja: hTal.nombre, deteccion: d })
      const idx = indicePorCanonico(d)
      const cNombre = idx.get('Talento')

      if (cNombre != null) {
        incidencias.push(...detectarHuerfanas(hTal, d, cNombre))

        if (d.columnasSinEncabezado.length > 0) {
          incidencias.push({
            codigo: 'BANDA_COLUMNAS_DESPLAZADA',
            severidad: 'AVISO',
            hoja: hTal.nombre,
            mensaje:
              `Hay ${d.columnasSinEncabezado.length} columna(s) con datos y sin ` +
              'encabezado. Su contenido no se importa; revísalo en el archivo.',
            crudo: { columnas: d.columnasSinEncabezado },
          })
        }

        for (let i = d.filaPrimerDato; i < hTal.filas.length; i++) {
          const fila = hTal.filas[i]!
          const nombre = texto(fila[cNombre])
          if (!nombre || esFilaCentinela(fila)) continue

          const e = entrada(nombre)
          for (const [header, campo] of [
            ['Categoría', 'category'],
            ['Tipo (casa / aliado)', 'relationshipType'],
            ['Notas / ángulo comercial', 'commercialNotes'],
            ['País / mercado', 'country'],
          ] as const) {
            const c = idx.get(header)
            if (c != null && texto(fila[c])) asignar(e, campo, texto(fila[c]))
          }
          const cVert = idx.get('Verticales que abre')
          if (cVert != null && texto(fila[cVert])) {
            asignar(
              e, 'verticals',
              texto(fila[cVert]).split(/[,;]/).map((s) => s.trim()).filter(Boolean),
            )
          }
          agregarMetricas(e, fila, idx, PLATAFORMAS_TALENTOS, hTal.nombre, i, nombre)
        }
      }
    }
  }

  // ═══════════════════ ROSTER ═══════════════════
  if (tipo === 'ROSTER') {
    const hBase = buscarHoja(hojas, SPEC_ROSTER_BASE.hoja)
    if (!hBase) {
      incidencias.push(hojaFaltante(SPEC_ROSTER_BASE.hoja, 'ERROR'))
    } else {
      const d = detectHeaderRow(hBase, SPEC_ROSTER_BASE)
      hojasDetectadas.push({ hoja: hBase.nombre, deteccion: d })
      const idx = indicePorCanonico(d)
      const cNombre = idx.get('Talento')

      if (cNombre != null) {
        incidencias.push(...detectarHuerfanas(hBase, d, cNombre))
        for (let i = d.filaPrimerDato; i < hBase.filas.length; i++) {
          const fila = hBase.filas[i]!
          const nombre = texto(fila[cNombre])
          if (!nombre || esFilaCentinela(fila)) continue
          const e = entrada(nombre)
          agregarMetricas(e, fila, idx, PLATAFORMAS_ROSTER, hBase.nombre, i, nombre)
          for (const [header, campo] of [
            ['Link Instagram', 'linkInstagram'],
            ['Link TikTok', 'linkTiktok'],
            ['Link YouTube', 'linkYoutube'],
          ] as const) {
            const c = idx.get(header)
            if (c != null && texto(fila[c])) asignar(e, campo, texto(fila[c]))
          }
        }
      }
    }

    // KIF: talentos aliados, sin tarifas.
    const hKif = buscarHoja(hojas, SPEC_KIF.hoja)
    if (hKif) {
      const d = detectHeaderRow(hKif, SPEC_KIF)
      hojasDetectadas.push({ hoja: hKif.nombre, deteccion: d })
      const idx = indicePorCanonico(d)
      const cNombre = idx.get('Talento')
      if (cNombre != null) {
        for (let i = d.filaPrimerDato; i < hKif.filas.length; i++) {
          const fila = hKif.filas[i]!
          const nombre = texto(fila[cNombre])
          if (!nombre || esFilaCentinela(fila)) continue
          const e = entrada(nombre)
          asignar(e, 'roster', 'KIF')
          for (const [header, campo] of [
            ['Categoría principal', 'category'],
            ['País', 'country'],
            ['Ciudad', 'city'],
            ['Username', 'username'],
          ] as const) {
            const c = idx.get(header)
            if (c != null && texto(fila[c])) asignar(e, campo, texto(fila[c]))
          }
        }
      }
    }
  }

  // ═══════════════════ Acciones y ausentes ═══════════════════
  // El índice apunta varias grafías a la misma entrada, así que hay que
  // quedarse con objetos únicos y no con una lista con repetidos.
  const talentos = [...new Set(porNormalizado.values())]
  for (const e of talentos) {
    if (e.talentIdExistente) {
      const cambia =
        Object.keys(e.cambiosTalento).length > 0 ||
        e.cambiosTarifas.length > 0 ||
        e.metricas.length > 0
      e.accion = cambia ? 'ACTUALIZAR' : 'SIN_CAMBIOS'
    } else {
      e.accion = 'CREAR'
    }
  }

  const vistos = new Set(
    talentos.map((e) => e.talentIdExistente).filter((x): x is string => Boolean(x)),
  )
  const ausentes = ctx.talentosConocidos
    .filter((t) => !vistos.has(t.talentId))
    .map((t) => ({ talentId: t.talentId, displayName: t.displayName }))

  for (const a of ausentes) {
    incidencias.push({
      codigo: 'TALENTO_AUSENTE',
      severidad: 'INFO',
      hoja: '(base de datos)',
      mensaje:
        `${a.displayName} está en el sistema y no viene en este archivo. ` +
        'Se marca como ausente; no se borra nada.',
    })
  }

  return {
    archivo: ctx.archivo,
    sha256: ctx.sha256,
    tipo,
    hojasDetectadas,
    talentos,
    ausentes,
    incidencias,
    resumen: resumir(talentos, incidencias),
  }
}

// ─────────────────────────── auxiliares ───────────────────────────

function hojaFaltante(nombre: string, severidad: Severidad = 'AVISO'): Incidencia {
  return {
    codigo: 'HOJA_FALTANTE',
    severidad,
    hoja: nombre,
    mensaje: `El archivo no trae la hoja "${nombre}".`,
  }
}

function asignar(e: EntradaPlanTalento, campo: string, valor: unknown): void {
  e.cambiosTalento[campo] = { antes: undefined, despues: valor }
}

function agregarMetricas(
  e: EntradaPlanTalento,
  fila: ValorCelda[],
  idx: Map<string, number>,
  plataformas: Array<{ header: string; plataforma: string }>,
  hoja: string,
  filaIdx: number,
  nombre: string,
): void {
  for (const { header, plataforma } of plataformas) {
    const c = idx.get(header)
    if (c == null) continue
    const crudo = fila[c]
    if (texto(crudo) === '') continue

    const m = parseFollowerCount(crudo, { plataforma, talento: nombre })
    const planeada: MetricaPlaneada = {
      plataforma,
      crudo: m.crudo,
      seguidores: m.seguidores,
      confianza: m.confianza,
      requiereRevision: m.requiereRevision,
      notas: m.notas,
    }
    e.metricas.push(planeada)

    if (m.confianza === 'FALLIDO') {
      e.incidencias.push({
        codigo: 'METRICA_NO_RECONOCIDA',
        severidad: 'AVISO',
        hoja, fila: filaIdx, columna: c,
        mensaje: `${nombre} · ${plataforma}: ${m.notas.join(' ')}`,
        crudo: m.crudo,
      })
    } else if (m.requiereRevision) {
      e.incidencias.push({
        codigo: m.confianza === 'INFERIDO' ? 'METRICA_INFERIDA' : 'METRICA_SOSPECHOSA',
        severidad: 'INFO',
        hoja, fila: filaIdx, columna: c,
        mensaje: `${nombre} · ${plataforma}: ${m.notas.join(' ')}`,
        crudo: m.crudo,
      })
    }
  }
}

function resumir(
  talentos: readonly EntradaPlanTalento[],
  incidencias: readonly Incidencia[],
): ResumenPlan {
  const todas = [...incidencias, ...talentos.flatMap((t) => t.incidencias)]
  const porSeveridad: Record<Severidad, number> = { INFO: 0, AVISO: 0, ERROR: 0 }
  for (const i of todas) porSeveridad[i.severidad]++

  return {
    talentosEnArchivo: talentos.length,
    aCrear: talentos.filter((t) => t.accion === 'CREAR').length,
    aActualizar: talentos.filter((t) => t.accion === 'ACTUALIZAR').length,
    sinCambios: talentos.filter((t) => t.accion === 'SIN_CAMBIOS').length,
    requierenRevision: talentos.filter((t) => t.identidad?.decision === 'REQUIERE_REVISION').length,
    tarifasNuevas: talentos.reduce(
      (s, t) => s + t.cambiosTarifas.filter((c) => c.antesPriceStatus === null).length, 0,
    ),
    tarifasModificadas: talentos.reduce(
      (s, t) => s + t.cambiosTarifas.filter((c) => c.antesPriceStatus !== null).length, 0,
    ),
    tarifasEnConflicto: talentos.reduce(
      (s, t) => s + t.cambiosTarifas.filter((c) => c.conflicto).length, 0,
    ),
    metricasNuevas: talentos.reduce((s, t) => s + t.metricas.length, 0),
    incidenciasPorSeveridad: porSeveridad,
  }
}
