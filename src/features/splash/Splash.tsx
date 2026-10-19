import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Zap } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";

export function Splash() {
  const navigate = useNavigate(); // Navegacion del panel
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(isAuthenticated ? ROUTES.DASHBOARD : ROUTES.LOGIN, { replace: true });
    }, 1800); // Timer con verificacion de autenticacion y redireccionamiento a dashboard o login
    return () => clearTimeout(timer);
  }, [navigate, isAuthenticated]);

  return (
    <div className="flex h-screen items-center justify-center bg-app-light dark:bg-app-dark">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="flex flex-col items-center gap-6"
      >
        <motion.div
          initial={{ rotate: -10 }}
          animate={{ rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary shadow-[0_24px_48px_rgba(0,122,255,0.3)]"
        >
          <Zap className="h-10 w-10 text-white" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 30 }}
          className="text-center"
        >
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">{t("app.name")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("app.subtitle")}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex gap-1.5"
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
