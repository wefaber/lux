import { Link, useNavigate } from "react-router-dom";
import { LogOut, Settings, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
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

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function Topbar() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <header className="sticky h-14 mx-5 my-3 flex items-center top-4 justify-between px-6 glass-topbar rounded-full">
      <div />
      <div className="flex items-center gap-3">
        <FontSizeControl />
        <ThemeSwitcher />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-muted transition-colors cursor-pointer">
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
                  <span className="font-normal text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={ROUTES.PROFILE} className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Perfil
                </Link>
              </DropdownMenuItem>
              {hasRole("root_admin", "admin") && (
                <DropdownMenuItem asChild>
                  <Link to={ROUTES.ADMIN} className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Panel Admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive hover:text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
