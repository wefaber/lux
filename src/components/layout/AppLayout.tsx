import { useRef } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TabBar } from "./TabBar";
import { PAGE_TRANSITION } from "@/lib/constants";
import { useResponsiveTables } from "@/hooks/useResponsiveTables";
import { NoticesProvider } from "@/hooks/useNotices";
import { OnboardingRoot } from "@/components/onboarding/OnboardingRoot";

export function AppLayout() {
  const location = useLocation();
  // El elemento se captura por ruta: <Outlet /> lee la ruta vigente al
  // renderizar, asi que la pagina que sale (AnimatePresence) pasaba a mostrar la
  // nueva dentro de su fade-out y despues se montaba de nuevo.
  const outlet = useOutlet();
  const mainRef = useRef<HTMLElement>(null);
  useResponsiveTables(mainRef); // tablas que no entran -> tarjetas

  return (
    // La guia de inicio envuelve todo el panel: la abre el primer ingreso o el menu
    <OnboardingRoot>
      {/* Los avisos los comparten el menu (el punto por seccion) y las listas */}
      <NoticesProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <div className="hidden md:flex h-full">
            <Sidebar />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <main ref={mainRef} className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  {...PAGE_TRANSITION}
                  className="min-h-full p-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:p-6 sm:pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-6 lg:px-8 lg:py-4"
                >
                  {outlet}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          <TabBar />
        </div>
      </NoticesProvider>
    </OnboardingRoot>
  );
}
