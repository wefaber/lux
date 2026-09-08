import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// La condicion va inline y no en una constante compartida: si se importa de
// otro modulo, rolldown deja de plegarla y un build sin mocks igual arrastra
// el chunk de MSW (623 KB) y las credenciales de prueba.
async function enableMocking(): Promise<void> {
  if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === "true") {
    const { worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

enableMocking().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
