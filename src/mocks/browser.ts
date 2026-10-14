import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { restoreMockData, saveMockData, syncWithOtherTabs } from "./persist";

// Lo que se cambio en la sesion anterior (tickets, prestamos, reservas...)
restoreMockData();
syncWithOtherTabs();

// Se guarda al salir de la pagina: recargar, cerrar la pestaña, cambiar de app
// en el telefono. No depende del worker, que se puede re-armar (mocks-runtime)
window.addEventListener("pagehide", saveMockData);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveMockData();
});

export const worker = setupWorker(...handlers);

// Cada cambio se guarda en el momento, asi las otras pestañas lo ven enseguida
worker.events.on("response:mocked", saveMockData);
