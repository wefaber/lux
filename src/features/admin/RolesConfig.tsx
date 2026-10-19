import { motion } from "motion/react";
import { Shield, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { ROLE_LABELS, SPRING_TRANSITION } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import { ADMIN_ROLES, STAFF_ROLES, USER_ROLES } from "@/lib/roles";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type PermissionKey =
  | "view_dashboard"
  | "view_inventory"
  | "edit_inventory"
  | "view_tickets"
  | "create_tickets"
  | "assign_tickets"
  | "resolve_tickets"
  | "request_loans"
  | "view_loans"
  | "manage_loans"
  | "view_services"
  | "manage_services"
  | "admin_panel"
  | "manage_users"
  | "view_logs"
  | "view_reports"
  | "export_data";

const PERMISSIONS: Array<{ key: PermissionKey; roles: UserRole[] }> = [
  { key: "view_dashboard", roles: USER_ROLES },
  { key: "view_inventory", roles: USER_ROLES },
  { key: "edit_inventory", roles: STAFF_ROLES },
  { key: "view_tickets", roles: USER_ROLES },
  { key: "create_tickets", roles: USER_ROLES },
  { key: "assign_tickets", roles: STAFF_ROLES },
  { key: "resolve_tickets", roles: STAFF_ROLES },
  { key: "request_loans", roles: USER_ROLES },
  { key: "view_loans", roles: STAFF_ROLES },
  { key: "manage_loans", roles: STAFF_ROLES },
  { key: "view_services", roles: USER_ROLES },
  { key: "manage_services", roles: STAFF_ROLES },
  { key: "admin_panel", roles: ADMIN_ROLES },
  { key: "manage_users", roles: ADMIN_ROLES },
  { key: "view_logs", roles: ADMIN_ROLES },
  { key: "view_reports", roles: ADMIN_ROLES },
  { key: "export_data", roles: ADMIN_ROLES },
]; // Vista de permisos por roles

export function RolesConfig() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("admin.roles.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("admin.roles.subtitle")}</p>
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
              {t("admin.roles.matrix")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {t("admin.roles.permission")}
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
                      <td className="px-4 py-3 text-sm text-foreground">
                        {t(`admin.roles.perm.${perm.key}`)}
                      </td>
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

            <p className="text-xs text-muted-foreground mt-4">{t("admin.roles.note")}</p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
