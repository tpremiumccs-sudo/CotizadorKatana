/**
 * Punto de arranque del proceso servidor. Next lo ejecuta UNA vez, antes de
 * atender la primera petición.
 *
 * Lo único que hace es cargar `@/env`, y eso es exactamente el punto: la
 * validación del entorno vivía colgada de `session.ts`, así que no se disparaba
 * hasta que alguien tocaba una página autenticada. Con una variable mal puesta,
 * `/api/health` devolvía 200, `./deploy.sh instalar` imprimía "responde
 * correctamente" en verde, y todas las páginas daban 500.
 */
export async function register() {
  // La instrumentación también corre en el runtime edge, donde `server-only` y
  // `process.env` completo no aplican. La app corre en Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    await import('@/env')
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error(`\n[katana] ${mensaje}\n`)

    // Next NO tumba el proceso cuando la instrumentación falla: se queda
    // escuchando y responde 500 a todo, `/api/health` incluido. Comprobado.
    // Para el contenedor eso significa quedarse en `restarting` sin decir por
    // qué, así que aquí se sale a mano y el error queda como última línea del
    // registro, que es donde se mira.
    //
    // Sólo en producción: en desarrollo es más útil el error en pantalla que un
    // `next dev` que se cierra solo.
    if (process.env.NODE_ENV === 'production') process.exit(1)
    throw e
  }
}
