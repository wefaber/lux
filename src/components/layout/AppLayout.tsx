import { useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TabBar } from "./TabBar";
import { PAGE_TRANSITION } from "@/lib/constants";
import { useResponsiveTables } from "@/hooks/useResponsiveTables";

export function AppLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useResponsiveTables(mainRef); // tablas que no entran -> tarjetas

  return (
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
              className="min-h-full p-6 pb-24 md:pb-6 lg:p-8"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <TabBar />
    </div>
  );
}
