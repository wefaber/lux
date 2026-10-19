import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { gql, cn, errorMessage } from "@/lib/utils";
import { ROLE_CONFIG, USER_STATUS_CONFIG } from "@/lib/constants";
import { USER_ROLES, canEditUser, canToggleUserActive } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";
import type { User, UserRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UPDATE_USER_MUTATION, UserForm } from "./UserForm";
import { OptionSelect } from "@/components/ui/option-select";
import { ErrorAlert } from "@/components/ui/error-alert";

const USERS_QUERY = `
  query GetUsers {
    users { id name dni email role isActive createdAt updatedAt }
  }
`;

export function UserManagement() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [actionError, setActionError] = useState("");
  const { user: me } = useAuth();

  const { data, isLoading, refetch } = useAsync<{ users: User[] }>(() => gql(USERS_QUERY), []);

  const users = (data?.users ?? []).filter((u) => {
    const matchSearch =
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.dni.includes(search) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  }); // Filtrado de usuarios en base a parametros

  const handleToggleActive = async (u: User) => {
    const isActive = !u.isActive;
    const question = isActive ? "admin.users.confirmActivate" : "admin.users.confirmDeactivate";
    if (!confirm(t(question, { name: u.name }))) return;
    setActionError("");
    try {
      // UserInput exige los datos de la persona: se mandan los actuales con el estado nuevo
      const { name, dni, email, role } = u;
      await gql(UPDATE_USER_MUTATION, { id: u.id, input: { name, dni, email, role, isActive } });
    } catch (err) {
      setActionError(errorMessage(err, t("admin.users.toggleFailed")));
    }
    refetch();
  }; // Alta / baja logica: un usuario inactivo no puede iniciar sesion

  // Show full skeleton ONLY on the very first empty load
  const showSkeleton = isLoading && !data;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("admin.users.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("admin.users.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t("admin.users.new")}
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("admin.users.search")}
            aria-label={t("admin.users.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <OptionSelect
          aria-label={t("admin.users.filterRole")}
          value={roleFilter}
          onValueChange={(v) => setRoleFilter(v as UserRole | "")}
          options={[
            { value: "", label: t("admin.users.allRoles") },
            ...USER_ROLES.map((r) => ({ value: r, label: ROLE_CONFIG[r].label })),
          ]}
        />
      </div>

      <ErrorAlert>{actionError}</ErrorAlert>

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={5} />
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm font-medium">
          {t("admin.users.empty")}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {[
                  t("label.name"),
                  t("label.dni"),
                  t("label.email"),
                  t("label.role"),
                  t("label.status"),
                  t("label.actions"),
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const status = USER_STATUS_CONFIG[u.isActive ? "active" : "inactive"];
                return (
                  <tr
                    key={u.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-semibold text-foreground">{u.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.dni}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge color={ROLE_CONFIG[u.role].color}>{ROLE_CONFIG[u.role].label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={status.color} withDot={u.isActive}>
                        {status.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {canEditUser(me, u) && (
                          <Button size="sm" variant="ghost" onClick={() => setEditUser(u)}>
                            {t("common.edit")}
                          </Button>
                        )}
                        {canToggleUserActive(me, u) && (
                          <Button
                            size="sm"
                            variant={u.isActive ? "destructive" : "success"}
                            onClick={() => handleToggleActive(u)}
                          >
                            {u.isActive ? t("admin.users.deactivate") : t("admin.users.activate")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.new")}</DialogTitle>
            <DialogDescription>{t("admin.users.createDescription")}</DialogDescription>
          </DialogHeader>
          <UserForm
            onSuccess={() => {
              setCreateOpen(false);
              refetch();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editUser !== null} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.editTitle")}</DialogTitle>
            <DialogDescription>{t("admin.users.editDescription")}</DialogDescription>
          </DialogHeader>
          {editUser && (
            <UserForm
              user={editUser}
              onSuccess={() => {
                setEditUser(null);
                refetch();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
