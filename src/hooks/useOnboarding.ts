import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  createElement,
  type ReactNode,
} from "react";
import {
  hasCompletedOnboarding,
  isLastStep,
  markOnboardingCompleted,
  nextStepIndex,
  onboardingStepsFor,
  previousStepIndex,
  type OnboardingStepId,
} from "@/lib/onboarding";
import { useAuth } from "./useAuth";

interface OnboardingContextType {
  /** La guia esta abierta (primer ingreso o reabierta desde el menu). */
  isOpen: boolean;
  /** Paso actual dentro de `steps`. */
  stepIndex: number;
  /** Recorrido del rol activo; vacio mientras no hay sesion. */
  steps: OnboardingStepId[];
  /** Reabre la guia desde el principio, aunque ya se haya visto. */
  openGuide: () => void;
  /** Cierra la guia y la da por vista (terminar, omitir, Esc o la X). */
  closeGuide: () => void;
  nextStep: () => void;
  previousStep: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);

// La guia se muestra sola una vez por usuario y navegador. Se guarda en
// localStorage con el id del usuario: no hace falta tocar la API porque es una
// preferencia de presentacion (si alguien entra desde otra maquina, ve la guia
// una vez ahi, que es justo lo que se quiere).
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const role = user?.role;
  const steps = useMemo(() => onboardingStepsFor(role), [role]);
  const [stepIndex, setStepIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Primer ingreso: si este usuario nunca la vio, se abre al entrar al panel.
  // Si cambia la sesion (otra pestaña), se recalcula para el usuario nuevo.
  useEffect(() => {
    if (!userId) {
      setIsOpen(false);
      return;
    }
    setStepIndex(0);
    setIsOpen(!hasCompletedOnboarding(userId));
  }, [userId]);

  const closeGuide = useCallback(() => {
    if (userId) markOnboardingCompleted(userId);
    setIsOpen(false);
  }, [userId]);

  const openGuide = useCallback(() => {
    setStepIndex(0);
    setIsOpen(true);
  }, []);

  const nextStep = useCallback(() => {
    if (isLastStep(stepIndex, steps.length)) {
      closeGuide();
      return;
    }
    setStepIndex(nextStepIndex(stepIndex, steps.length));
  }, [stepIndex, steps.length, closeGuide]);

  const previousStep = useCallback(() => {
    setStepIndex(previousStepIndex(stepIndex, steps.length));
  }, [stepIndex, steps.length]);

  const value = useMemo<OnboardingContextType>(
    () => ({ isOpen, stepIndex, steps, openGuide, closeGuide, nextStep, previousStep }),
    [isOpen, stepIndex, steps, openGuide, closeGuide, nextStep, previousStep],
  );

  return createElement(OnboardingContext.Provider, { value }, children);
}

export function useOnboarding(): OnboardingContextType {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
