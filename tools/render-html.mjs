#!/usr/bin/env node
/**
 * Renderizador mínimo de HTML a PDF con Chromium.
 *
 * Lo usa `tools/calibrar.py` y las pruebas de fidelidad. Es deliberadamente
 * tonto: recibe un HTML y escupe un PDF, con exactamente la misma
 * configuración que usa la aplicación en src/server/pdf/.
 *
 *   node tools/render-html.mjs entrada.html salida.pdf
 *
 * El HTML debe ser AUTOSUFICIENTE (fuentes e imágenes como data: URI): se
 * bloquea toda petición de red, igual que en producción.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [, , entrada, salida] = process.argv
if (!entrada || !salida) {
  console.error('Uso: node tools/render-html.mjs entrada.html salida.pdf')
  process.exit(2)
}

const html = await readFile(entrada, 'utf8')

const ejecutable = process.env.CHROMIUM_EXECUTABLE_PATH || undefined
const navegador = await chromium.launch({
  executablePath: ejecutable,
  args: ['--font-render-hinting=none', '--disable-lcd-text'],
})

try {
  const pagina = await navegador.newPage()

  // Ninguna petición sale de la página: el documento se basta a sí mismo.
  await pagina.route('**/*', (ruta) => {
    const url = ruta.request().url()
    if (url.startsWith('data:') || url.startsWith('about:')) return ruta.continue()
    return ruta.abort()
  })

  await pagina.setContent(html, { waitUntil: 'load' })
  await pagina.evaluate(() => document.fonts.ready)

  const pdf = await pagina.pdf({
    // El tamaño lo manda @page del CSS, no un ajuste de Playwright.
    preferCSSPageSize: true,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  })

  await writeFile(salida, pdf)
  console.log(`PDF escrito en ${salida} (${pdf.length} bytes)`)
} finally {
  await navegador.close()
}
