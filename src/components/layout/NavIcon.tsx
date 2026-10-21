import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { UnseenDot } from "@/components/ui/unseen-dot";
import type { NavItem } from "./navItems";

// Icono de una seccion del menu, con un punto ambar si tiene avisos sin ver.
// El punto va sobre el icono para que se vea tambien con el menu colapsado
export function NavIcon({ item, className }: { item: NavItem; className?: string }) {
  const { hasNotices } = useNotices();
  const { t } = useI18n();
  const Icon = item.icon;
  const unseen = item.notices !== undefined && hasNotices(item.notices);

  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={className} />
      {unseen && <UnseenDot label={t("nav.unseen")} />}
    </span>
  );
}
