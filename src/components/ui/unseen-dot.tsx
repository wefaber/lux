import { cn } from "@/lib/utils";

// Punto ambar de "hay algo sin ver", sobre la esquina de un icono o boton (el
// padre tiene que ser relative). El texto queda para lectores de pantalla
export function UnseenDot({ label, className }: { label: string; className?: string }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background",
          className,
        )}
      />
      <span className="sr-only">({label})</span>
    </>
  );
}
