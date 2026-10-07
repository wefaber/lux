// Re-armado de los mocks cuando el service worker queda mudo.
//
// MSW guarda la lista de clientes activos DENTRO del service worker
// (activeClientIds en public/mockServiceWorker.js) y bypassa toda peticion
// cuando esa lista esta vacia. La pagina manda MOCK_ACTIVATE una sola vez, en
// worker.start(). Si el browser termina esa instancia del SW (inactividad,
// dormir la maquina, pestaña congelada, presion de memoria) la registracion
// sigue viva y navigator.serviceWorker.controller sigue apuntando al script,
// pero la instancia nueva arranca con la lista vacia: MSW deja de interceptar
// y todo /graphql se va a nginx, que responde 405 porque no hay backend.
//
// stop() + start() vuelve a mandar MOCK_ACTIVATE, asi que la instancia viva
// vuelve a interceptar sin recargar la pagina.
//
// El import de ./browser es dinamico a proposito: este modulo lo importa el
// resto de la app y no debe arrastrar el chunk de MSW (623 KB) al bundle.

let rearmando: Promise<void> | null = null;

export async function reArmMocks(): Promise<void> {
  if (rearmando) return rearmando;

  rearmando = (async () => {
    const { worker } = await import("@/mocks/browser");
    worker.stop();
    await worker.start({ onUnhandledRequest: "bypass", quiet: true });
  })();

  try {
    await rearmando;
  } finally {
    rearmando = null;
  }
}
