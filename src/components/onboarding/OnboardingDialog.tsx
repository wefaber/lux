import {
  BookOpen,
  Check,
  ClipboardCheck,
  ListChecks,
  Package,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
  isLastStep,
  onboardingContentFor,
  onboardingProgress,
  type OnboardingStepId,
} from "@/lib/onboarding";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { FontSizeControl } from "@/components/accessibility/FontSizeControl";
import { HighContrastToggle } from "@/components/accessibility/HighContrastToggle";
import { DyslexicFontToggle } from "@/components/accessibility/DyslexicFontToggle";
import { LanguageSwitcher } from "@/components/accessibility/LanguageSwitcher";

// Icono de cada paso; el texto sale del diccionario (lib/onboarding).
const STEP_ICONS: Record<OnboardingStepId, LucideIcon> = {
  welcome: Sparkles,
  reportTicket: Ticket,
  workQueue: ListChecks,
  requestService: Wrench,
  manageRequests: ClipboardCheck,
  loans: BookOpen,
  staffTools: Package,
  adminPanel: Shield,
  preferences: SlidersHorizontal,
};

// Preferencias en el momento: los mismos controles del perfil, sin duplicar la
// logica de useTheme.
function PreferencesStep() {
  const { t } = useI18n();
  const rows = [
    { label: t("profile.a11y.theme"), control: <ThemeSwitcher /> },
    { label: t("profile.a11y.fontSize"), control: <FontSizeControl /> },
    { label: t("profile.a11y.contrast"), control: <HighContrastToggle /> },
    { label: t("profile.a11y.dyslexic"), control: <DyslexicFontToggle /> },
    { label: t("profile.a11y.language"), control: <LanguageSwitcher /> },
  ];
  return (
    <>
      <ul className="mt-5 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
        {rows.map(({ label, control }) => (
          <li
            key={label}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5 sm:px-4"
          >
            <span className="min-w-0 text-sm font-medium text-foreground">{label}</span>
            <div className="shrink-0">{control}</div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t("onboarding.preferences.note")}</p>
    </>
  );
}

export function OnboardingDialog() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { isOpen, stepIndex, steps, closeGuide, nextStep, previousStep } = useOnboarding();

  if (!user || steps.length === 0) return null;

  const index = Math.min(stepIndex, steps.length - 1);
  const stepId = steps[index];
  const step = onboardingContentFor(stepId, user.role);
  const Icon = STEP_ICONS[stepId];
  const last = isLastStep(index, steps.length);
  const stepLabel = t("onboarding.stepOf", { current: index + 1, total: steps.length });
  const flow = step.flow ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeGuide()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="shrink-0 space-y-2 border-b border-border/20 px-5 pb-3 pr-14 pt-5 sm:px-6 sm:pr-16">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {t("onboarding.title")}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{stepLabel}</span>
          </div>
          <Progress
            value={onboardingProgress(index, steps.length)}
            aria-label={t("onboarding.progress")}
            aria-valuetext={stepLabel}
            className="h-1.5"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <p className="sr-only" aria-live="polite">
            {stepLabel}: {t(step.title)}
          </p>

          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{t(step.title)}</DialogTitle>
              <DialogDescription className="mt-1">{t(step.description)}</DialogDescription>
            </div>
          </div>

          {flow.length > 0 && (
            <section aria-label={t("onboarding.flow")} className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("onboarding.flow")}
              </p>
              <ol className="grid gap-1.5 sm:grid-cols-3">
                {flow.map((key, flowIndex) => (
                  <li
                    key={key}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2 text-xs font-medium text-foreground"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {flowIndex + 1}
                    </span>
                    <span className="min-w-0">{t(key)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {step.points.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {step.points.map((key) => (
                <li key={key} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span className="text-sm text-foreground">{t(key)}</span>
                </li>
              ))}
            </ul>
          )}

          {stepId === "preferences" && <PreferencesStep />}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/20 px-5 py-4 sm:px-6">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={closeGuide}
              className="order-2 self-center sm:order-1 sm:self-auto"
            >
              {t("onboarding.skip")}
            </Button>
            <div className="order-1 flex gap-2 sm:order-2">
              <Button
                variant="secondary"
                size="md"
                onClick={previousStep}
                disabled={index === 0}
                className="flex-1 sm:flex-none"
              >
                {t("common.previous")}
              </Button>
              <Button size="md" onClick={nextStep} className="flex-1 sm:flex-none">
                {last ? t("onboarding.finish") : t("common.next")}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
