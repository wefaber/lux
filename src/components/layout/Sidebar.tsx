import { useState } from "react";
import { NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPRING_TRANSITION } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { navItemsFor } from "./navItems";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  const visibleItems = navItemsFor(user?.role); // El usuario final no ve las secciones del personal

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={SPRING_TRANSITION}
      className="relative flex h-[calc(100vh-2rem)] top-[calc(1rem)] left-4 mr-3 flex-col glass-sidebar overflow-hidden rounded-xl"
    >
      <div className="flex items-center justify-between p-4 h-14">
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                Lux
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        {collapsed && (
          <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-2 space-y-2 overflow-y-auto">
        {visibleItems.map(({ icon: Icon, label, to, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 cursor-pointer",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                  : "text-muted-foreground",
                collapsed && "justify-center px-2",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  className="truncate overflow-hidden whitespace-nowrap"
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </NavLink>
        ))}
      </nav>

      <div className="p-2 border-t border-sidebar-border">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer",
            collapsed && "justify-center px-2",
          )}
          aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span className="text-xs">Colapsar</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
