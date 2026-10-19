import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, Edit2, Trash2 } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate } from "@/lib/utils";
import { ROUTES, SPRING_TRANSITION } from "@/lib/constants";
import type { Component } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { RetireEquipmentDialog } from "./RetireEquipmentDialog";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";
import { DetailRow } from "@/components/ui/detail-row";

const COMPONENT_QUERY = `
  query GetComponent($id: ID!) {
    component(id: $id) {
      id type name model manufacturer serialNumber partNumber isFactory isWorking productId createdAt updatedAt deletedAt
    }
  }
`;

export function ComponentDetail() {
  const { id } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [retireOpen, setRetireOpen] = useState(false);
  const { data, isLoading, error } = useAsync<{ component: Component | null }>(
    () => gql(COMPONENT_QUERY, { id }),
    [id],
  );

  const component = data?.component;
  const canEdit = hasRole(...STAFF_ROLES) && !component?.deletedAt;

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.INVENTORY}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-foreground flex-1 min-w-[12rem]">
          {isLoading
            ? "..."
            : component
              ? `${component.name} — ${component.model}`
              : t("component.detail.notFound")}
        </h1>
        {canEdit && component && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.INVENTORY}/componente/${id}/editar`}>
                <Edit2 className="h-3.5 w-3.5" />
                {t("inventory.detail.edit")}
              </Link>
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setRetireOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("inventory.detail.retire")}
            </Button>
          </div>
        )}
      </div>

      {component && id && (
        <RetireEquipmentDialog
          kind="component"
          id={id}
          name={`${component.name} ${component.model}`}
          open={retireOpen}
          onOpenChange={setRetireOpen}
          onRetired={() => navigate(ROUTES.INVENTORY)}
        />
      )}

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}

      {component && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_TRANSITION}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("component.detail.info")}</CardTitle>
                <div className="flex gap-2">
                  <Badge color={component.isFactory ? "info" : "muted"}>
                    {component.isFactory
                      ? t("component.detail.factory")
                      : t("component.detail.replacement")}
                  </Badge>
                  <Badge color={component.isWorking ? "success" : "destructive"}>
                    {component.isWorking
                      ? t("component.detail.working")
                      : t("component.detail.faulty")}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <DetailRow label={t("label.name")} value={component.name} />
                <DetailRow label={t("label.model")} value={component.model} />
                <DetailRow label={t("label.manufacturer")} value={component.manufacturer} />
                <DetailRow
                  label={t("label.serialNumber")}
                  value={<span className="font-mono text-xs">{component.serialNumber}</span>}
                />
                <DetailRow
                  label={t("label.partNumber")}
                  value={<span className="font-mono text-xs">{component.partNumber}</span>}
                />
                <DetailRow
                  label={t("component.detail.parent")}
                  value={component.productId ?? t("component.detail.standalone")}
                />
                <DetailRow
                  label={t("inventory.detail.registered")}
                  value={formatDate(component.createdAt)}
                />
                <DetailRow label={t("label.updated")} value={formatDate(component.updatedAt)} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
