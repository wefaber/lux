import { useNotices } from "@/hooks/useNotices";
import type { NavItem } from "./navItems";

// Icono de una seccion del menu, con un punto ambar si tiene avisos sin ver.
// El punto va sobre el icono para que se vea tambien con el menu colapsado
export function NavIcon({ item, className }: { item: NavItem; className?: string }) {
  const { hasNotices } = useNotices();
  const Icon = item.icon;
  const unseen = item.notices !== undefined && hasNotices(item.notices);

  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={className} />
      {unseen && (
        <>
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background"
          />
          <span className="sr-only">(avisos sin ver)</span>
        </>
      )}
    </span>
  );
}
