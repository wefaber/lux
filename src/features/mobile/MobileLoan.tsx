import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, QrCode, Ticket } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoanForm } from "@/features/loans/LoanForm";

// Solicitud de prestamo desde el telefono: reusa el formulario de escritorio. El
// equipo escaneado llega en ?equipo= y queda elegido.
export function MobileLoan() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const equipmentId = params.get("equipo") ?? "";
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Card className="space-y-3 p-5 text-center hover:translate-y-0">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
        <p className="text-sm text-foreground" role="status">
          {t("mobile.loan.done")}
        </p>
        <Button variant="secondary" className="w-full" asChild>
          <Link to={ROUTES.MOBILE_TICKETS}>
            <Ticket className="h-4 w-4" />
            {t("mobile.tab.tickets")}
          </Link>
        </Button>
        <Button className="w-full" asChild>
          <Link to={ROUTES.MOBILE}>{t("mobile.home")}</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("mobile.loan.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("mobile.loan.subtitle")}</p>
      </div>
      <Button variant="secondary" className="w-full" asChild>
        <Link to={`${ROUTES.MOBILE_SCAN}?context=loan`}>
          <QrCode className="h-4 w-4" />
          {t("mobile.loan.scan")}
        </Link>
      </Button>
      <Card className="hover:translate-y-0">
        <CardContent className="p-4">
          {/* La clave rearma el formulario si llega otro equipo escaneado */}
          <LoanForm
            key={equipmentId}
            initialEquipmentId={equipmentId || undefined}
            onSuccess={() => setDone(true)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
