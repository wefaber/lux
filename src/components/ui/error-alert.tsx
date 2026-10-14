import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Mensaje de error de un formulario, dialogo o pagina. Sin contenido no dibuja nada,
// asi se puede usar directo con el estado de error: <ErrorAlert>{error}</ErrorAlert>
export function ErrorAlert({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}
