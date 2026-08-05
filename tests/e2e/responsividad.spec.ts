import {
  test, expect, sembrar, limpiar, entrar, crearCotizacion,
  desbordeHorizontal, objetivosPequenos, violacionesAxe, prisma,
} from './apoyo'

/**
 * Las mismas seis pantallas en escritorio, iPad y celular.
 *
 * El uso real es enseñar el iPad en una junta y mandar el PDF desde el
 * celular, así que "funciona en mi monitor" no es un criterio.
 */

let rutaCotizacion: string

test.beforeAll(async ({ browser }) => {
  await sembrar()
  const page = await browser.newPage()
  await entrar(page)
  rutaCotizacion = new URL(await crearCotizacion(page)).pathname
  await page.close()
})

test.afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

test.beforeEach(async ({ page }) => {
  await entrar(page)
})

const RUTAS = [
  { ruta: '/', nombre: 'inicio' },
  { ruta: '/cotizaciones', nombre: 'lista de cotizaciones' },
  { ruta: '/cotizaciones/nueva', nombre: 'nueva cotización' },
  { ruta: '/tarifario', nombre: 'tarifario' },
  { ruta: '/talentos', nombre: 'talentos' },
  { ruta: '/admin/bitacora', nombre: 'bitácora' },
]

test.describe('sin desbordamiento horizontal', () => {
  for (const { ruta, nombre } of RUTAS) {
    test(`${nombre} cabe a lo ancho`, async ({ page }) => {
      await page.goto(ruta)
      // `networkidle` no sirve aquí: el enrutador de Next va prefetcheando las
      // rutas de la barra y la red nunca se queda quieta. Se espera al
      // contenido, que es lo que de verdad importa medir.
      await page.locator('main').first().waitFor()
      expect(await desbordeHorizontal(page)).toBeLessThanOrEqual(1)
    })
  }

  test('el editor cabe, con la matriz y con el documento a la vista', async ({ page }) => {
    await page.goto(rutaCotizacion)
    await page.waitForSelector('table')
    expect(await desbordeHorizontal(page), 'con la matriz').toBeLessThanOrEqual(1)

    // En celular y iPad vertical las dos vistas se alternan; hay que probar
    // las dos, porque el documento mide 612 pt de ancho fijo.
    const segmentado = page.getByRole('button', { name: 'Documento' })
    if (await segmentado.isVisible()) {
      await segmentado.click()
      await page.locator('iframe[title="Vista previa del documento"]').waitFor()
      expect(await desbordeHorizontal(page), 'con el documento').toBeLessThanOrEqual(1)
    }
  })
})

test.describe('objetivos táctiles', () => {
  for (const { ruta, nombre } of RUTAS) {
    test(`${nombre}: nada por debajo de 44 px`, async ({ page }) => {
      await page.goto(ruta)
      // `networkidle` no sirve aquí: el enrutador de Next va prefetcheando las
      // rutas de la barra y la red nunca se queda quieta. Se espera al
      // contenido, que es lo que de verdad importa medir.
      await page.locator('main').first().waitFor()
      expect(await objetivosPequenos(page)).toEqual([])
    })
  }

  test('las celdas de precio se pueden pulsar con el dedo', async ({ page }) => {
    await page.goto(rutaCotizacion)
    await page.waitForSelector('table')
    const campo = page.getByLabel(/^Precio de Ronny, TIKTOK$/).first()
    const caja = await campo.boundingBox()
    expect(caja!.height).toBeGreaterThanOrEqual(44)
  })
})

test.describe('accesibilidad', () => {
  for (const { ruta, nombre } of RUTAS) {
    test(`${nombre}: sin violaciones serias ni críticas`, async ({ page }) => {
      await page.goto(ruta)
      // `networkidle` no sirve aquí: el enrutador de Next va prefetcheando las
      // rutas de la barra y la red nunca se queda quieta. Se espera al
      // contenido, que es lo que de verdad importa medir.
      await page.locator('main').first().waitFor()
      const v = await violacionesAxe(page)
      expect(
        v.map((x) => `${x.id} (${x.impact}): ${x.nodes[0]?.target.join(' ')}`),
      ).toEqual([])
    })
  }

  test('el editor tampoco', async ({ page }) => {
    await page.goto(rutaCotizacion)
    await page.waitForSelector('table')
    const v = await violacionesAxe(page)
    expect(v.map((x) => `${x.id} (${x.impact})`)).toEqual([])
  })

  test('la pantalla de acceso tampoco', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/acceso')
    const v = await violacionesAxe(page)
    expect(v.map((x) => `${x.id} (${x.impact})`)).toEqual([])
  })
})

test.describe('cabeceras de seguridad', () => {
  test('la CSP va con nonce y no bloquea la vista previa', async ({ page }) => {
    const r = await page.goto('/cotizaciones')
    const csp = r!.headers()['content-security-policy'] ?? ''
    expect(csp, 'hay CSP').toContain("default-src 'self'")
    expect(csp, 'con nonce por petición').toMatch(/nonce-[A-Za-z0-9+/=]+/)
    expect(csp, 'nada sale hacia fuera').toContain("connect-src 'self'")
    // `'none'` dejaría el documento en blanco: la vista previa es un iframe de
    // mismo origen. Lo que se impide es que OTRO sitio enmarque la app.
    expect(csp).toContain("frame-ancestors 'self'")
    expect(r!.headers()['x-frame-options']).toBe('SAMEORIGIN')
    expect(r!.headers()['x-content-type-options']).toBe('nosniff')
    expect(r!.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('el nonce cambia en cada petición', async ({ page }) => {
    const leer = async () => {
      const r = await page.goto('/cotizaciones')
      return /nonce-([A-Za-z0-9+/=]+)/.exec(
        r!.headers()['content-security-policy'] ?? '',
      )?.[1]
    }
    const a = await leer()
    const b = await leer()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })
})

test.describe('navegación con teclado', () => {
  test('se puede entrar sin tocar el ratón', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/acceso')
    await page.getByLabel('Correo').focus()
    await page.keyboard.type('e2e-admin@katana.local')
    await page.keyboard.press('Tab')
    await page.keyboard.type('una frase larga para las pruebas')
    await page.keyboard.press('Enter')
    await page.waitForURL('/', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Cotizador' })).toBeVisible()
  })

  test('el foco se ve al tabular', async ({ page }) => {
    await page.goto('/cotizaciones')
    await page.keyboard.press('Tab')
    const contorno = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      return { outline: s.outlineStyle, ancho: s.outlineWidth }
    })
    expect(contorno).not.toBeNull()
    expect(contorno!.outline).not.toBe('none')
  })
})
