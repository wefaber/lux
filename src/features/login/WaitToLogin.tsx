import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { ROUTES } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";

export function WaitToLogin() {
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate(ROUTES.DASHBOARD, { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(ROUTES.LOGIN, { replace: true });
    }, 8000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-light dark:bg-app-dark">
      <div className="w-full max-w-md px-4 space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <Skeleton className="h-4 w-32 rounded mb-1.5" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/40 backdrop-blur-xl p-6 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-8 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>

        <div className="flex items-center justify-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            className="h-5 w-5 rounded-full border-2 border-border border-t-[rgb(0,122,255)]"
          />
          <span className="text-sm text-muted-foreground">{t("wait.preparing")}</span>
        </div>
      </div>
    </div>
  );
}
