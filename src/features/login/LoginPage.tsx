import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { Zap, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";
import { DevCredentials } from "./DevCredentials";

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState)?.from?.pathname ?? ROUTES.DASHBOARD;

  const runLogin = async (userDni: string, userPassword: string) => {
    setError("");
    try {
      await login(userDni, userPassword);
      navigate(from, { replace: true });
    } catch {
      setAttempts((a) => a + 1);
      setError("Credenciales inválidas. Verificá tu cédula y contraseña.");
    }
  }; // Autenticacion compartida por el formulario y la burbuja de mocks

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dni.trim() || !password.trim()) {
      setError("Completá todos los campos.");
      return;
    }
    if (!/^\d{7,8}$/.test(dni.trim())) {
      setError("El número de cédula debe tener 7 u 8 dígitos.");
      return;
    }
    await runLogin(dni.trim(), password);
  };

  const fillCredentials = (nextDni: string, nextPassword: string) => {
    setDni(nextDni);
    setPassword(nextPassword);
    setError("");
  }; // Completa el formulario desde la burbuja de mocks

  const loginAs = async (nextDni: string, nextPassword: string) => {
    fillCredentials(nextDni, nextPassword);
    await runLogin(nextDni, nextPassword);
  }; // Entra directo con un usuario de prueba

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-light dark:bg-app-dark p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-[0_16px_32px_rgba(0,122,255,0.25)] mb-5">
            <Zap className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Iniciá sesión</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ITI CETP — Sistema de Gestión de Recursos
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card/40 p-6 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="dni">Número de cédula</Label>
              <Input
                id="dni"
                type="text"
                inputMode="numeric"
                placeholder="Ej: 12345678"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                maxLength={8}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground dark:hover:text-white transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2.5"
              >
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive">{error}</p>
              </motion.div>
            )}

            {attempts >= 3 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl bg-[rgba(255,159,10,0.08)] border border-warning-border px-3 py-2 flex items-center gap-2"
              >
                <div className="h-2 w-full bg-[rgba(255,159,10,0.2)] rounded-full">
                  <div
                    className="h-full bg-[rgb(255,159,10)] rounded-full transition-all"
                    style={{ width: `${Math.min(attempts * 20, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-warning whitespace-nowrap">{attempts} intentos</span>
              </motion.div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                />
              ) : (
                "Ingresar"
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ITI CETP 2026 · Los accesos son gestionados por administración
        </p>
      </motion.div>

      {/* Misma condicion que arranca MSW en main.tsx, inline por el mismo motivo:
          la burbuja existe donde existen los mocks */}
      {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === "true") && (
        <DevCredentials onFill={fillCredentials} onLogin={loginAs} />
      )}
    </div>
  );
}
