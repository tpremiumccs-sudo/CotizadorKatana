import 'server-only'
import { chromium, type Browser, type Page } from 'playwright'
import { renderDocumentHtml } from '@/lib/doc/render'
import { fuentesDocumento, logoDataUri } from '@/server/pdf/fuentes'
import type { Documento } from '@/lib/doc/tipos'

/**
 * Impresión del documento a PDF.
 *
 * Arrancar Chromium cuesta cerca de un segundo, así que el navegador se
 * mantiene vivo entre peticiones y cada documento usa un contexto nuevo —que
 * es barato y además aísla: dos cotizaciones que se imprimen a la vez no
 * comparten nada.
 *
 * El HTML que se imprime es AUTOSUFICIENTE: fuentes y logo van embebidos como
 * `data:` URI y toda petición de red se aborta. Con eso desaparecen de un golpe
 * la ruta de render interna, el token que haría falta para protegerla y
 * cualquier posibilidad de que la página pida algo a `db:5432`.
 */

/** Un documento nunca debería tardar esto; si lo hace, algo se atascó. */
const TIEMPO_MAXIMO_MS = 20_000

let navegadorPrometido: Promise<Browser> | null = null

async function navegador(): Promise<Browser> {
  navegadorPrometido ??= chromium
    .launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      // Sin hinting ni subpíxel: es lo que hace que el texto salga en las
      // mismas posiciones dentro del contenedor y en el iPad.
      args: ['--font-render-hinting=none', '--disable-lcd-text'],
    })
    .then((b) => {
      // Si Chromium se muere —OOM, un crash—, la próxima petición lo levanta
      // en vez de quedarse con una referencia inservible para siempre.
      b.on('disconnected', () => {
        navegadorPrometido = null
      })
      return b
    })
    .catch((e) => {
      navegadorPrometido = null
      throw e
    })
  return navegadorPrometido
}

/** El contenido no cupo en la página y el PDF habría salido recortado. */
export class DesbordamientoError extends Error {
  readonly pagina: number
  readonly excesoPt: number
  constructor(pagina: number, excesoPt: number) {
    super(
      `El contenido no cabe en la página ${pagina}: se sale ${excesoPt.toFixed(1)} pt. ` +
        'El PDF habría salido recortado, así que no se generó.',
    )
    this.name = 'DesbordamientoError'
    this.pagina = pagina
    this.excesoPt = excesoPt
  }
}

/**
 * Comprueba que nada se sale de su página.
 *
 * `overflow:hidden` en `.pagina` evita páginas fantasma, pero también OCULTA el
 * desbordamiento: sin esta guarda, una cotización con demasiados talentos
 * saldría cortada y nadie se enteraría hasta que la marca preguntara por el
 * renglón que falta. Vale ~2 ms y convierte un error silencioso en uno ruidoso.
 */
async function verificarDesbordamiento(pagina: Page): Promise<void> {
  const problema = await pagina.evaluate(() => {
    const paginas = Array.from(document.querySelectorAll('.pagina'))
    for (const [i, p] of paginas.entries()) {
      // Se compara contra la caja de SU PROPIA página, no contra una constante:
      // `getBoundingClientRect` devuelve píxeles CSS y el documento está
      // definido en puntos. Preguntándolo así la unidad se cancela y la
      // comprobación es la que de verdad importa — ¿este hijo se sale de su
      // hoja?
      const caja = p.getBoundingClientRect()
      let maximo = 0
      for (const hijo of Array.from(p.children)) {
        maximo = Math.max(maximo, (hijo as HTMLElement).getBoundingClientRect().bottom)
      }
      // Medio píxel de tolerancia: el redondeo de subpíxel de Chromium no es un
      // desbordamiento.
      if (maximo > caja.bottom + 0.5) {
        // De vuelta a puntos, que es la unidad en la que está escrito el
        // documento y en la que se puede razonar sobre el arreglo.
        const excesoPt = ((maximo - caja.bottom) * 72) / 96
        return { pagina: i + 1, exceso: excesoPt }
      }
    }
    return null
  })

  if (problema) throw new DesbordamientoError(problema.pagina, problema.exceso)
}

export interface ResultadoPdf {
  bytes: Buffer
  paginas: number
  ms: number
}

/** Imprime un documento ya resuelto. */
export async function renderPdf(doc: Documento): Promise<ResultadoPdf> {
  const t0 = Date.now()
  const html = renderDocumentHtml(doc, fuentesDocumento(), 'print')

  const b = await navegador()
  const contexto = await b.newContext()
  try {
    const pagina = await contexto.newPage()
    pagina.setDefaultTimeout(TIEMPO_MAXIMO_MS)

    // Nada sale de la página: el documento se basta a sí mismo.
    await pagina.route('**/*', (ruta) => {
      const url = ruta.request().url()
      if (url.startsWith('data:') || url.startsWith('about:')) return ruta.continue()
      return ruta.abort()
    })

    await pagina.setContent(html, { waitUntil: 'load' })
    // Sin esperar a las fuentes, la primera página sale con la métrica de
    // reserva y el documento no coincide con el original.
    await pagina.evaluate(() => document.fonts.ready)

    await verificarDesbordamiento(pagina)

    const paginas = await pagina.evaluate(
      () => document.querySelectorAll('.pagina').length,
    )

    const bytes = await pagina.pdf({
      // El tamaño lo manda @page del CSS, no un ajuste de Playwright.
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })

    return { bytes, paginas, ms: Date.now() - t0 }
  } finally {
    await contexto.close()
  }
}

export { logoDataUri }
