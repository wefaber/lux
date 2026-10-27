import { CheckCircle2, Clock3, Timer } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatDuration } from "@/lib/utils";
import { TICKET_CATEGORY_LABELS } from "@/lib/constants";
import type { TicketEstimates } from "@/lib/types";

function EstimateValue({ hours }: { hours: number | null }) {
  if (hours === null) return <span className="text-muted-foreground">—</span>;
  return <>~{formatDuration(hours)}</>;
}

// Promedios de los tickets ya resueltos: cuanto se tarda en atenderlos y en
// resolverlos. Se aclara que es historico para no prometer un plazo.
export function RequesterEstimates({ estimates }: { estimates: TicketEstimates }) {
  const { t } = useI18n();
  const hasData = estimates.sampleSize > 0;
  return (
    <section
      aria-label={t("home.estimates.title")}
      className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6"
    >
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">{t("home.estimates.title")}</p>
      </div>

      {hasData ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("home.estimates.help", { count: estimates.sampleSize })}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <Clock3 className="h-4 w-4 text-warning" />
              <p className="mt-2 text-xs text-muted-foreground">{t("home.estimates.attend")}</p>
              <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                <EstimateValue hours={estimates.toAttendHours} />
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <p className="mt-2 text-xs text-muted-foreground">{t("home.estimates.resolve")}</p>
              <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                <EstimateValue hours={estimates.toResolveHours} />
              </p>
            </div>
          </div>

          {estimates.byCategory.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("home.estimates.byCategory")} · {t("home.estimates.attend")} /{" "}
                {t("home.estimates.resolve")}
              </p>
              <dl className="mt-2 space-y-1.5">
                {estimates.byCategory.map((estimate) => (
                  <div
                    key={estimate.category}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <dt className="text-muted-foreground">
                      {TICKET_CATEGORY_LABELS[estimate.category]}
                    </dt>
                    <dd className="text-foreground tabular-nums">
                      <EstimateValue hours={estimate.toAttendHours} /> /{" "}
                      <EstimateValue hours={estimate.toResolveHours} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{t("home.estimates.noData")}</p>
      )}
    </section>
  );
}
