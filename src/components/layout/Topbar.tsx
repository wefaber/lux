import { Link, useNavigate } from "react-router-dom";
import { LogOut, Settings, Shield, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { LanguageSwitcher } from "@/components/accessibility/LanguageSwitcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { FontSizeControl } from "@/components/accessibility/FontSizeControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROUTES, ROLE_LABELS } from "@/lib/constants";
import { ADMIN_ROLES } from "@/lib/roles";
import { initials } from "@/lib/utils";

export function Topbar() {
  const { user, logout, hasRole } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <header className="sticky top-2 mx-3 my-2 flex h-14 items-center justify-between rounded-full px-3 glass-topbar sm:top-4 sm:mx-5 sm:my-3 sm:px-6">
      {/* En el telefono el menu lateral no esta: la marca hace de referencia */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {t("app.name")}
        </span>
      </div>
      <div className="hidden md:block" />
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Preferencias de letra e idioma: en el telefono viven en el perfil, aca
            no entran y dejaban el avatar cortado */}
        <div className="hidden sm:block">
          <FontSizeControl />
        </div>
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>
        <ThemeSwitcher />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex min-h-11 min-w-11 items-center gap-2.5 rounded-xl px-1 hover:bg-muted transition-colors cursor-pointer sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-1">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex flex-col items-start">
                  <span className="text-xs font-medium text-foreground leading-none">
                    {user.name.split(" ")[0]}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                    {ROLE_LABELS[user.role]}
                  </span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground text-xs normal-case tracking-normal">
                    {user.name}
                  </span>
                  <span className="font-normal text-muted-foreground normal-case tracking-normal">
                    {user.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={ROUTES.PROFILE} className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  {t("topbar.profile")}
                </Link>
              </DropdownMenuItem>
              {hasRole(...ADMIN_ROLES) && (
                <DropdownMenuItem asChild>
                  <Link to={ROUTES.ADMIN} className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {t("topbar.admin")}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive hover:text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                {t("topbar.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
