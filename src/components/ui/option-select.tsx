import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface Option {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface OptionSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
  /** sm: filtros compactos (h-8); md: el alto de los demas campos (h-10) */
  size?: "sm" | "md";
  className?: string;
}

// Radix no admite "" como valor de un item; las opciones "Todos..." lo usan
const EMPTY = "__vacio__";

// Lista de opciones con el estilo de la app (bordes, fondo, modo oscuro), en vez
// del desplegable nativo del sistema operativo. Misma API que un <select>
// controlado: un value de texto y "" para "ninguno / todos".
export function OptionSelect({
  value,
  onValueChange,
  options,
  id,
  "aria-label": ariaLabel,
  placeholder,
  disabled,
  size = "md",
  className,
}: OptionSelectProps) {
  // Con una opcion "" propia ("Todos los estados") el vacio se elige como
  // cualquier otra; sin ella, "" deja el campo sin elegir y muestra el placeholder
  const hasEmptyOption = options.some((o) => o.value === "");
  return (
    <Select
      value={value === "" && hasEmptyOption ? EMPTY : value}
      onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "w-auto gap-2 cursor-pointer disabled:cursor-not-allowed",
          size === "sm" && "h-8 rounded-lg px-2.5 text-xs",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || EMPTY} value={o.value || EMPTY} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
