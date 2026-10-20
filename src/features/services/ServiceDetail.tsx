import { useParams, Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, UserCheck } from "lucide-react";
import { useState } from "react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, errorMessage } from "@/lib/utils";
import {
  SERVICE_STATUS_CONFIG,
  SERVICE_TYPE_LABELS,
  ROUTES,
  SPRING_TRANSITION,
  SERVICE_TRANSITIONS,
  SERVICE_STATUSES_WITH_RESOLUTION,
} from "@/lib/constants";
import type { ServiceRequest, ServiceStatus, User } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommentThread } from "@/components/comments/CommentThread";
import { UserSearchSelect, type UserOption } from "@/components/search-pickers";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";

const SERVICE_QUERY = `
 query GetServiceRequest($id: ID!) {
 serviceRequest(id: $id) {
 id type status description labNumber softwareName equipmentId resolutionText
 requestedBy { id name email }
 assignedTo { id name }
 createdAt updatedAt
 }
 }
`; // Query para service ID, status, description, labNumber, softwareName, equipmentId, resolutionText, requestedBy (id, name, email), createdAt, updatedAt

const UPDATE_SERVICE_MUTATION = `
 mutation UpdateServiceRequest($id: ID!, $input: ServiceRequestUpdateInput!) {
 updateServiceRequest(id: $id, input: $input) { id status }
 }
`; // Alteracion del Service

const CLAIM_SERVICE_MUTATION = `
 mutation ClaimServiceRequest($id: ID!) { claimServiceRequest(id: $id) { id } }
`;
const ASSIGN_SERVICE_MUTATION = `
 mutation AssignServiceRequest($id: ID!, $technicianId: ID!) {
 assignServiceRequest(id: $id, technicianId: $technicianId) { id }
 }
`;
const STAFF_USERS_QUERY = `
 query GetUsers($isActive: Boolean) { users(isActive: $isActive) { id name dni role } }
`;
// Estados a los que el staff puede pasar una solicitud

export function ServiceDetail() {
  const { id } = useParams<{ id: string }>(); // Variable constante ID con parametros String
  const { hasRole } = useAuth(); // Verificacion de roles con Auth
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState<ServiceStatus | "">(""); // Actualizacion de Estatus con parametro de estado de servicio
  const [resolution, setResolution] = useState(""); // Setear resolucion y establecer

  const { data, error, refetch } = useAsync<{ serviceRequest: ServiceRequest | null }>(
    () => gql(SERVICE_QUERY, { id }),
    [id],
  ); // Solicitud (Fetch) de servicio por parte del frontend

  // Al recargar se sigue mostrando la solicitud (y el comentario a medio escribir);
  // solo se descarta si es la de otra ruta
  const service = data?.serviceRequest?.id === id ? data?.serviceRequest : null;
  const canManage = hasRole(...STAFF_ROLES); // Verificacion si puede gestionar
  const [assignError, setAssignError] = useState("");
  // El responsable recien elegido se muestra mientras se recarga la solicitud;
  // deja de valer en cuanto llegan los datos nuevos
  const [pendingAssignee, setPendingAssignee] = useState<{ id: string; data: typeof data } | null>(
    null,
  );

  const { data: usersData } = useAsync<{ users: User[] } | null>(
    () => (canManage ? gql(STAFF_USERS_QUERY, { isActive: true }) : Promise.resolve(null)),
    [canManage],
  );
  const staff = (usersData?.users ?? []).filter((u) => u.role !== "solicitante");
  // El asignado puede no estar en la lista (dado de baja, o la lista todavia cargando):
  // se suma igual para que el campo lo muestre
  const assignee = service?.assignedTo;
  const technicians: UserOption[] =
    assignee && !staff.some((u) => u.id === assignee.id) ? [...staff, assignee] : staff;
  const assigneeId =
    pendingAssignee && pendingAssignee.data === data ? pendingAssignee.id : (assignee?.id ?? "");
  // Los estados a los que puede pasar: los mismos que acepta la API
  const nextStatuses = service ? SERVICE_TRANSITIONS[service.status] : [];
  const isClosed = nextStatuses.length === 0;
  const needsResolution = !!newStatus && SERVICE_STATUSES_WITH_RESOLUTION.includes(newStatus);
  const [updateError, setUpdateError] = useState("");

  const assign = async (mutation: string, variables: Record<string, unknown>) => {
    setAssignError("");
    try {
      await gql(mutation, variables);
      refetch();
    } catch (err) {
      setPendingAssignee(null);
      setAssignError(errorMessage(err, t("services.detail.assignFailed")));
    }
  };

  const handleUpdate = async () => {
    if (!id || !newStatus) return;
    setSaving(true);
    setUpdateError("");
    try {
      await gql(UPDATE_SERVICE_MUTATION, {
        id,
        input: { status: newStatus, resolutionText: needsResolution ? resolution : undefined },
      });
      refetch();
      setNewStatus("");
      setResolution("");
    } catch (err) {
      setUpdateError(errorMessage(err, t("services.detail.updateFailed")));
    } finally {
      setSaving(false);
    }
  }; // Actualizacion de servicio (datos)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 max-w-2xl">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.SERVICES}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-foreground flex-1 min-w-[12rem]">
          {t("services.detail.title")}
        </h1>
        {canManage && service && !service.assignedTo && !isClosed && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => assign(CLAIM_SERVICE_MUTATION, { id })}
          >
            <UserCheck className="h-3.5 w-3.5" />
            {t("services.detail.claim")}
          </Button>
        )}
      </div>

      <ErrorAlert>{assignError}</ErrorAlert>

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}

      {service && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_TRANSITION}
          // En pantallas anchas los comentarios van al costado, en el espacio que
          // dejaba libre el detalle; en angostas quedan debajo
          className="grid gap-4 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)]"
        >
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{SERVICE_TYPE_LABELS[service.type]}</CardTitle>
                  <Badge color={SERVICE_STATUS_CONFIG[service.status].color}>
                    {SERVICE_STATUS_CONFIG[service.status].label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                      {t("label.requester")}
                    </p>
                    <p className="text-foreground">{service.requestedBy.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                      {t("label.date")}
                    </p>
                    <p className="text-foreground">{formatDate(service.createdAt)}</p>
                  </div>
                  {canManage && !isClosed ? (
                    <div>
                      <label
                        htmlFor="service-assignee"
                        className="block text-xs text-muted-foreground uppercase tracking-widest mb-0.5"
                      >
                        {t("label.assignedTo")}
                      </label>
                      <div className="max-w-60">
                        {/* No se puede dejar sin responsable: borrar el campo y salir
                            vuelve a mostrar el asignado */}
                        <UserSearchSelect
                          id="service-assignee"
                          showDni={false}
                          items={technicians}
                          value={assigneeId}
                          onChange={(technicianId) => {
                            if (!technicianId || technicianId === assigneeId) return;
                            setPendingAssignee({ id: technicianId, data });
                            void assign(ASSIGN_SERVICE_MUTATION, { id, technicianId });
                          }}
                          // La lista es mas ancha que el campo
                          listClassName="w-max max-w-[min(26rem,80vw)]"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                        {t("label.assignedTo")}
                      </p>
                      <p className="text-foreground">{assignee?.name ?? t("common.unassigned")}</p>
                    </div>
                  )}
                  {service.labNumber && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                        {t("services.detail.lab")}
                      </p>
                      <p className="text-foreground">
                        {t("services.detail.labNumber", { number: service.labNumber })}
                      </p>
                    </div>
                  )}
                  {service.softwareName && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                        {t("services.detail.software")}
                      </p>
                      <p className="text-foreground">{service.softwareName}</p>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                    {t("label.description")}
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">{service.description}</p>
                </div>
                {service.resolutionText && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                      {t("services.detail.resolution")}
                    </p>
                    <p className="text-sm text-foreground leading-relaxed">
                      {service.resolutionText}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {canManage && !isClosed && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("services.detail.updateTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>{t("services.detail.newStatus")}</Label>
                    <Select
                      value={newStatus}
                      onValueChange={(v) => setNewStatus(v as ServiceStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("services.detail.selectStatus")} />
                      </SelectTrigger>
                      <SelectContent>
                        {nextStatuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SERVICE_STATUS_CONFIG[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {needsResolution && (
                    <div className="space-y-1.5">
                      <Label>{t("services.detail.resolutionText")}</Label>
                      <Textarea
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        placeholder={t("services.detail.resolutionPlaceholder")}
                        className="h-24"
                      />
                    </div>
                  )}
                  <ErrorAlert>{updateError}</ErrorAlert>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleUpdate} disabled={saving || !newStatus}>
                      {saving ? t("common.saving") : t("services.detail.update")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Al costado, los comentarios llegan justo hasta el final de la columna
              del detalle: no le suman alto a la fila y la lista se desplaza por dentro */}
          <div className="relative xl:min-h-[26rem]">
            <div className="xl:absolute xl:inset-0">
              <CommentThread entityType="service_request" entityId={service.id} fill />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
