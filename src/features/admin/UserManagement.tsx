import { useState } from "react";
import { Plus, Search, Upload } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { gql, cn, errorMessage, formatDate } from "@/lib/utils";
import { ROLE_CONFIG, STUDENT_SHIFT_LABELS, USER_STATUS_CONFIG } from "@/lib/constants";
import { USER_ROLES, canEditUser, canToggleUserActive } from "@/lib/roles";
import {
  filterUsers,
  hasStudentInfo,
  studentGroups,
  studentSubjects,
} from "@/lib/students";
import { useAuth } from "@/hooks/useAuth";
import type { StudentShift, User, UserRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailRow } from "@/components/ui/detail-row";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UPDATE_USER_MUTATION, UserForm } from "./UserForm";
import { UserImportDialog } from "./UserImportDialog";
import { OptionSelect } from "@/components/ui/option-select";
import { ErrorAlert } from "@/components/ui/error-alert";

const USERS_QUERY = `
  query GetUsers {
    users {
      id name dni email role isActive
      studentGroup studentShift studentSubjects
      createdAt updatedAt
    }
  }
`;

export function UserManagement() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [groupFilter, setGroupFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState<StudentShift | "">("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [actionError, setActionError] = useState("");
  const { user: me } = useAuth();

  const { data, isLoading, refetch } = useAsync<{ users: User[] }>(() => gql(USERS_QUERY), []);

  const allUsers = data?.users ?? [];
  // Filtros en memoria (la API recibe los mismos por GraphQL); la funcion pura
  // vive en lib/students para poder probarla sin montar la pantalla.
  const users = filterUsers(allUsers, {
    search,
    role: roleFilter,
    group: groupFilter,
    shift: shiftFilter,
    subject: subjectFilter,
  });
  const groups = studentGroups(allUsers);
  const subjects = studentSubjects(allUsers);

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("admin.users.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("admin.users.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5" />
            {t("admin.users.import")}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("admin.users.new")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full min-w-0 basis-full flex-1 sm:basis-0 sm:max-w-sm">
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
        <OptionSelect
          aria-label={t("admin.users.filterGroup")}
          value={groupFilter}
          onValueChange={setGroupFilter}
          options={[
            { value: "", label: t("admin.users.allGroups") },
            ...groups.map((g) => ({ value: g, label: g })),
          ]}
        />
        <OptionSelect
          aria-label={t("admin.users.filterShift")}
          value={shiftFilter}
          onValueChange={(v) => setShiftFilter(v as StudentShift | "")}
          options={[
            { value: "", label: t("admin.users.allShifts") },
            ...(Object.keys(STUDENT_SHIFT_LABELS) as StudentShift[]).map((shift) => ({
              value: shift,
              label: STUDENT_SHIFT_LABELS[shift],
            })),
          ]}
        />
        <OptionSelect
          aria-label={t("admin.users.filterSubject")}
          value={subjectFilter}
          onValueChange={setSubjectFilter}
          options={[
            { value: "", label: t("admin.users.allSubjects") },
            ...subjects.map((subject) => ({ value: subject, label: subject })),
          ]}
        />
      </div>

      <ErrorAlert>{actionError}</ErrorAlert>

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={7} />
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
                  t("label.student"),
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
                    <td className="px-4 py-3 text-sm font-semibold text-foreground">
                      <button
                        type="button"
                        className="text-left hover:underline underline-offset-4 cursor-pointer"
                        onClick={() => setDetailUser(u)}
                      >
                        {u.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.dni}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <StudentCell user={u} />
                    </td>
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

      {/* Ficha: lo mismo que muestra la tabla, con la ficha de estudiante completa */}
      <Dialog open={detailUser !== null} onOpenChange={(open) => !open && setDetailUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.users.detailTitle", { name: detailUser?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("admin.users.detailDescription")}</DialogDescription>
          </DialogHeader>
          {detailUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailRow label={t("label.name")} value={detailUser.name} />
                <DetailRow label={t("label.dni")} value={detailUser.dni || "—"} />
                <DetailRow label={t("label.email")} value={detailUser.email || "—"} />
                <DetailRow
                  label={t("label.role")}
                  value={
                    <Badge color={ROLE_CONFIG[detailUser.role].color}>
                      {ROLE_CONFIG[detailUser.role].label}
                    </Badge>
                  }
                />
                <DetailRow
                  label={t("label.status")}
                  value={
                    <Badge
                      color={USER_STATUS_CONFIG[detailUser.isActive ? "active" : "inactive"].color}
                      withDot={detailUser.isActive}
                    >
                      {USER_STATUS_CONFIG[detailUser.isActive ? "active" : "inactive"].label}
                    </Badge>
                  }
                />
                <DetailRow
                  label={t("label.updated")}
                  value={formatDate(detailUser.updatedAt)}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-sm font-medium text-foreground">
                  {t("admin.users.studentInfo")}
                </p>
                {detailUser.role === "solicitante" && hasStudentInfo(detailUser) ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailRow
                      label={t("label.group")}
                      value={detailUser.studentGroup ?? "—"}
                    />
                    <DetailRow
                      label={t("label.shift")}
                      value={
                        detailUser.studentShift
                          ? STUDENT_SHIFT_LABELS[detailUser.studentShift]
                          : "—"
                      }
                    />
                    <div className="sm:col-span-2">
                      <DetailRow
                        label={t("label.subjects")}
                        value={
                          detailUser.studentSubjects.length ? (
                            <span className="flex flex-wrap gap-1">
                              {detailUser.studentSubjects.map((subject) => (
                                <Badge key={subject} color="muted">
                                  {subject}
                                </Badge>
                              ))}
                            </span>
                          ) : (
                            "—"
                          )
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("admin.users.noStudentInfo")}</p>
                )}
              </div>

              {canEditUser(me, detailUser) && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditUser(detailUser);
                      setDetailUser(null);
                    }}
                  >
                    {t("common.edit")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <UserImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refetch}
      />
    </div>
  );
}

// Ficha de estudiante resumida para la tabla: grupo · turno y hasta 3 materias
function StudentCell({ user }: { user: User }) {
  const { t } = useI18n();
  if (user.role !== "solicitante" || !hasStudentInfo(user)) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const line = [
    user.studentGroup,
    user.studentShift ? STUDENT_SHIFT_LABELS[user.studentShift] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const shown = user.studentSubjects.slice(0, 3);
  return (
    <div className="min-w-[8rem] space-y-1">
      <span className="block text-sm text-foreground">{line || t("common.noData")}</span>
      {shown.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {shown.map((subject) => (
            <Badge key={subject} color="muted">
              {subject}
            </Badge>
          ))}
          {user.studentSubjects.length > shown.length && (
            <Badge color="muted">+{user.studentSubjects.length - shown.length}</Badge>
          )}
        </span>
      )}
    </div>
  );
}
