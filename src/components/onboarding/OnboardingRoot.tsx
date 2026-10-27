import type { ReactNode } from "react";
import { OnboardingProvider } from "@/hooks/useOnboarding";
import { OnboardingDialog } from "./OnboardingDialog";

// Envuelve el panel autenticado: provee el estado de la guia y la monta una
// sola vez por layout (dashboard o admin).
export function OnboardingRoot({ children }: { children: ReactNode }) {
  return (
    <OnboardingProvider>
      {children}
      <OnboardingDialog />
    </OnboardingProvider>
  );
}
