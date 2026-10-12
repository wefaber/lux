import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES, SPRING_TRANSITION } from "@/lib/constants";

export function ServerErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-light dark:bg-app-dark">
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
          Error del servidor
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          Ocurrió un error inesperado. Por favor, intentá de nuevo.
        </p>
        <Button asChild variant="secondary">
          <Link to={ROUTES.DASHBOARD}>
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}

// Pagina de 500 por error de servidor