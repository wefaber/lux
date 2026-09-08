import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FlaskConical, PenLine, X } from "lucide-react";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { ROLE_LABELS, SPRING_TRANSITION } from "@/lib/constants";
import { mockPasswords, mockUsers } from "@/mocks/data/users";
import type { UserRole } from "@/lib/types";

interface MockCredential {
  id: string;
  name: string;
  dni: string;
  password: string;
  role: UserRole;
  isActive: boolean;
} // Usuario de prueba con su contraseña resuelta desde el mock

const ROLE_ORDER: UserRole[] = ["root_admin", "admin", "tecnico", "solicitante"];

const ROLE_BADGE: Record<UserRole, BadgeColor> = {
  root_admin: "destructive",
  admin: "info",
  tecnico: "warning",
  solicitante: "success",
}; // Color de badge por rol

// Se resuelve dentro del componente: en el modulo se evaluaria siempre y los
// mocks quedarian dentro del bundle de produccion.
function groupByRole(showAll: boolean) {
  return ROLE_ORDER.map((role) => {
    const users: MockCredential[] = mockUsers
      .filter((u) => u.role === role)
      .map((u) => ({
        id: u.id,
        name: u.name,
        dni: u.dni,
        password: mockPasswords[u.dni] ?? "",
        role: u.role,
        isActive: u.isActive,
      }));
    return { role, total: users.length, users: showAll ? users : users.slice(0, 1) };
  });
} // Agrupa por rol; colapsado muestra solo el primero de cada uno

interface CredentialRowProps {
  credential: MockCredential;
  onFill: (dni: string, password: string) => void;
  onLogin: (dni: string, password: string) => void;
}

function CredentialRow({ credential, onFill, onLogin }: CredentialRowProps) {
  const { name, dni, password, isActive } = credential;
  return (
    <li className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onLogin(dni, password)}
        title="Entrar como este usuario"
        className="min-w-0 flex-1 cursor-pointer rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{name}</span>
          {!isActive && (
            <Badge color="muted" className="shrink-0 px-1.5 py-0 text-[10px]">
              Inactivo
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
          {dni} · {password}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onFill(dni, password)}
        title="Solo completar los campos"
        aria-label={`Completar los campos con ${name}`}
        className="shrink-0 cursor-pointer rounded-lg border border-border/70 p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PenLine className="h-3.5 w-3.5" />
      </button>
    </li>
  );
} // Fila: click entra directo, el lapiz solo completa el formulario

interface DevCredentialsProps {
  onFill: (dni: string, password: string) => void;
  onLogin: (dni: string, password: string) => void;
}

export function DevCredentials({ onFill, onLogin }: DevCredentialsProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const groups = groupByRole(showAll);

  const handleLogin = (dni: string, password: string) => {
    setOpen(false);
    onLogin(dni, password);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={SPRING_TRANSITION}
            role="dialog"
            aria-label="Credenciales de prueba"
            className="w-[min(20rem,calc(100vw-2rem))] origin-bottom-right rounded-2xl border border-border bg-card/95 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">Credenciales de prueba</p>
                <p className="text-[11px] text-muted-foreground">Modo mocks (MSW) · solo en dev</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar credenciales de prueba"
                className="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              {groups.map(({ role, users, total }) => (
                <section key={role} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Badge color={ROLE_BADGE[role]}>{ROLE_LABELS[role]}</Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {showAll ? `${total} usuarios` : `1 de ${total}`}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {users.map((credential) => (
                      <CredentialRow
                        key={credential.id}
                        credential={credential}
                        onFill={onFill}
                        onLogin={handleLogin}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="mt-3 w-full cursor-pointer rounded-xl border border-border/70 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/70"
            >
              {showAll ? "Ver uno por rol" : `Ver todos (${mockUsers.length})`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-warning-border bg-[rgba(255,159,10,0.12)] px-3.5 py-2 text-xs font-semibold text-warning shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-colors hover:bg-[rgba(255,159,10,0.2)]"
      >
        <FlaskConical className="h-4 w-4" />
        {open ? "Cerrar" : "Credenciales de prueba"}
      </motion.button>
    </div>
  );
} // Burbuja flotante de credenciales, se monta solo con los mocks activos
