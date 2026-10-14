import { motion } from "motion/react";
import { Shield, CheckCircle2, XCircle } from "lucide-react";
import { ROLE_LABELS, SPRING_TRANSITION } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import { ADMIN_ROLES, STAFF_ROLES, USER_ROLES } from "@/lib/roles";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const PERMISSIONS: Array<{ label: string; key: string; roles: UserRole[] }> = [
  {
    label: "Ver dashboard",
    key: "view_dashboard",
    roles: USER_ROLES,
  },
  {
    label: "Ver inventario",
    key: "view_inventory",
    roles: USER_ROLES,
  },
  { label: "Editar inventario", key: "edit_inventory", roles: STAFF_ROLES },
  {
    label: "Ver tickets",
    key: "view_tickets",
    roles: USER_ROLES,
  },
  {
    label: "Crear tickets",
    key: "create_tickets",
    roles: USER_ROLES,
  },
  { label: "Asignar tickets", key: "assign_tickets", roles: STAFF_ROLES },
  { label: "Resolver tickets", key: "resolve_tickets", roles: STAFF_ROLES },
  {
    label: "Solicitar préstamos",
    key: "request_loans",
    roles: USER_ROLES,
  },
  {
    label: "Ver todos los préstamos",
    key: "view_loans",
    roles: STAFF_ROLES,
  },
  { label: "Gestionar préstamos", key: "manage_loans", roles: STAFF_ROLES },
  {
    label: "Ver solicitudes",
    key: "view_services",
    roles: USER_ROLES,
  },
  {
    label: "Gestionar solicitudes",
    key: "manage_services",
    roles: STAFF_ROLES,
  },
  { label: "Panel de admin", key: "admin_panel", roles: ADMIN_ROLES },
  { label: "Gestionar usuarios", key: "manage_users", roles: ADMIN_ROLES },
  { label: "Ver logs de actividad", key: "view_logs", roles: ADMIN_ROLES },
  { label: "Ver reportes", key: "view_reports", roles: ADMIN_ROLES },
  { label: "Exportar datos", key: "export_data", roles: ADMIN_ROLES },
]; // Vista de permisos por roles

export function RolesConfig() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Roles y Permisos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Matriz de control de acceso por rol</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_TRANSITION}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Matriz RBAC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Permiso
                    </th>
                    {USER_ROLES.map((r) => (
                      <th
                        key={r}
                        className="px-4 py-3 text-center text-xs font-medium uppercase tracking-widest text-muted-foreground"
                      >
                        {ROLE_LABELS[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((perm, i) => (
                    <motion.tr
                      key={perm.key}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ ...SPRING_TRANSITION, delay: i * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-black/2 dark:hover:bg-white/3 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">{perm.label}</td>
                      {USER_ROLES.map((r) => (
                        <td key={r} className="px-4 py-3 text-center">
                          {perm.roles.includes(r) ? (
                            <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-black/15 dark:text-foreground/15 mx-auto" />
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Los cambios de permisos toman efecto en la próxima sesión del usuario. El rol
              root_admin no puede ser modificado ni eliminado.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
