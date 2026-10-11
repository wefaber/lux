import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useHaptics } from "@/hooks/useHaptics";
import { navItemsFor } from "./navItems";
import { NavIcon } from "./NavIcon";

export function TabBar() {
  const { user } = useAuth();
  const { trigger } = useHaptics();

  const visibleItems = navItemsFor(user?.role).filter((item) => item.inTabBar);

  return (
    <nav
      className="md:hidden fixed bottom-5 left-3 right-3 glass-topbar border rounded-full border-border z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex h-14">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] transition-colors select-none",
                isActive ? "text-primary" : "text-muted-foreground active:opacity-50",
              )
            }
            onClick={() => trigger(30)}
          >
            <NavIcon item={item} className="h-[22px] w-[22px]" />
            <span className="leading-none">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
