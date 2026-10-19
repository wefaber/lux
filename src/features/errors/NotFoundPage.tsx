import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { ROUTES, SPRING_TRANSITION } from "@/lib/constants";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-light dark:bg-app-dark">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_TRANSITION}
        className="text-center space-y-4"
      >
        <p className="text-8xl font-semibold tracking-[-0.04em] text-black/10 dark:text-foreground/10">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("errorPage.404.title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs">{t("errorPage.404.text")}</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={ROUTES.DASHBOARD}>
            <ArrowLeft className="h-4 w-4" />
            {t("errorPage.backHome")}
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}

// Pagina de error 404
