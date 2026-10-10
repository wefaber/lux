import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import type { User, UserRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserForm } from "./UserForm";
import { OptionSelect } from "@/components/ui/option-select";

const USERS_QUERY = `
  query GetUsers {
    users { id name dni email role isActive createdAt updatedAt }
  }
`;

const DELETE_USER_MUTATION = `
  mutation DeleteUser($id: ID!) { deleteUser(id: $id) }
`;

export function UserManagement() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

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

  const handleDelete = async (id: string) => {
    if (!confirm("¿Desactivar este usuario?")) return;
    await gql(DELETE_USER_MUTATION, { id });
    refetch();
  }; // Gestion de borrar usuario logicamente

  // Show full skeleton ONLY on the very first empty load
  const showSkeleton = isLoading && !data;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestión de accesos al sistema</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo usuario
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, cédula, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <OptionSelect
          aria-label="Filtrar por rol"
          value={roleFilter}
          onValueChange={(v) => setRoleFilter(v as UserRole | "")}
          options={[
            { value: "", label: "Todos los roles" },
            { value: "root_admin", label: "Super Admin" },
            { value: "admin", label: "Administrador" },
            { value: "tecnico", label: "Técnico" },
            { value: "solicitante", label: "Solicitante" },
          ]}
        />
      </div>

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={5} />
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm font-medium">
          No se encontraron usuarios
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
                {["Nombre", "Cédula", "Email", "Rol", "Estado", "Acciones"].map((h) => (
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
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">{u.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.dni}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge
                      color={
                        u.role === "root_admin"
                          ? "destructive"
                          : u.role === "admin"
                            ? "warning"
                            : u.role === "tecnico"
                              ? "info"
                              : "muted"
                      }
                    >
                      {ROLE_LABELS[u.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={u.isActive ? "success" : "destructive"} withDot={u.isActive}>
                      {u.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditUser(u)}>
                        Editar
                      </Button>
                      {u.role !== "root_admin" && u.isActive && (
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(u.id)}>
                          Desactivar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
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
            <DialogTitle>Editar usuario</DialogTitle>
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
