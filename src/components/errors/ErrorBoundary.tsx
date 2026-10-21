import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { ROUTES, SPRING_TRANSITION } from "@/lib/constants";
import { captureError } from "@/lib/error-tracker";

// Ultimo recurso de React: si un componente lanza durante el render, se reporta
// al issue tracker y se muestra una pantalla estable (sin router, porque el
// error pudo ocurrir dentro del propio RouterProvider).

export function GlobalErrorFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-light dark:bg-app-dark p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_TRANSITION}
        className="text-center space-y-4"
      >
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(255,159,10,0.1)]">
            <AlertTriangle className="h-8 w-8 text-warning" />
          </div>
        </div>
        <p className="text-6xl font-semibold tracking-[-0.04em] text-black/10 dark:text-foreground/10">
          500
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("errorPage.500.title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs">{t("errorPage.500.text")}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button variant="default" onClick={() => window.location.reload()}>
            <RotateCcw className="h-4 w-4" />
            {t("errorPage.reload")}
          </Button>
          <Button asChild variant="secondary">
            <a href={ROUTES.DASHBOARD}>
              <ArrowLeft className="h-4 w-4" />
              {t("errorPage.backHome")}
            </a>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // El componentStack ayuda a ubicar el componente; no se agrega al mensaje
    // del error para no mezclar formatos en la huella.
    captureError(error);
    if (import.meta.env.DEV) console.error("[error-boundary]", error, info.componentStack);
  }

  render() {
    return this.state.failed ? <GlobalErrorFallback /> : this.props.children;
  }
}
