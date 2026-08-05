import { NextResponse, type NextRequest } from 'next/server'

/**
 * Cabeceras de seguridad y política de contenido.
 *
 * La CSP va con `nonce` por petición y no con `unsafe-inline`: Next inyecta
 * scripts en línea para hidratar, y la única forma de permitirlos sin abrir la
 * puerta a cualquier otro es firmarlos con un valor que cambia cada vez.
 *
 * Lo que esta política protege de verdad: el documento se dibuja a partir de
 * texto que viene del Excel de la agencia y de lo que se teclea en el editor —
 * nombres de talento, notas, nombres de cliente—. Ese texto se escapa al
 * generar el HTML, pero una CSP estricta es la segunda cerradura, la que sigue
 * cerrada si algún día se escapa un escape.
 */

/** Rutas que no necesitan pasar por aquí. */
export const config = {
  matcher: [
    // Todo salvo los estáticos, que Next sirve con sus propias cabeceras y que
    // no ejecutan nada.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export function middleware(req: NextRequest) {
  const n = nonce()
  const enProduccion = process.env.NODE_ENV === 'production'

  const csp = [
    "default-src 'self'",
    // `strict-dynamic` deja que los scripts firmados carguen los suyos, que es
    // como Next arranca sus fragmentos. En desarrollo hace falta `unsafe-eval`
    // para el refresco en caliente; en producción no.
    `script-src 'self' 'nonce-${n}' 'strict-dynamic' ${enProduccion ? '' : "'unsafe-eval'"}`,
    // Los estilos van en línea porque Tailwind los emite así en desarrollo y
    // el documento lleva su propio <style>. Un `style-src` con nonce rompería
    // el iframe del preview, que se reescribe desde el cliente.
    "style-src 'self' 'unsafe-inline'",
    // El logo va como data: URI dentro del documento.
    "img-src 'self' data: blob:",
    // Las fuentes del documento también.
    "font-src 'self' data:",
    // NADA sale hacia fuera: la app no llama a ningún servicio externo.
    "connect-src 'self'",
    // El preview es un iframe de mismo origen.
    "frame-src 'self' blob:",
    // `'self'` y NO `'none'`: la vista previa es un iframe de mismo origen y
    // `'none'` la bloquea igual que bloquearía a un tercero — el documento se
    // queda en blanco y sin decir por qué. Lo que hay que impedir es que OTRO
    // sitio enmarque la app para robar clics, y eso `'self'` ya lo impide.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(enProduccion ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  // El nonce viaja a los componentes de servidor por cabecera: Next lo lee de
  // aquí para firmar sus propios scripts.
  const cabeceras = new Headers(req.headers)
  cabeceras.set('x-nonce', n)

  const res = NextResponse.next({ request: { headers: cabeceras } })

  res.headers.set('content-security-policy', csp)
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  // Nada de esto se usa; se apaga para que un script inyectado tampoco pueda.
  res.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  )
  // Para navegadores viejos que no entienden `frame-ancestors`. SAMEORIGIN por
  // el mismo motivo: DENY dejaría la vista previa en blanco.
  res.headers.set('x-frame-options', 'SAMEORIGIN')
  if (enProduccion) {
    // Un año, con subdominios. Detrás de Cloudflare Tunnel siempre es https.
    res.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains',
    )
  }

  return res
}
