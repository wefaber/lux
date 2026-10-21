import { useRef, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/hooks/useI18n";

// "salon" encuentra "Salón": se compara sin mayusculas ni tildes
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export interface SearchSelectProps<T> {
  id?: string;
  items: T[];
  /** Clave del elemento elegido; "" = ninguno */
  value: string;
  onChange: (key: string) => void;
  getKey: (item: T) => string;
  /** Texto que muestra el campo cuando hay un elemento elegido */
  getLabel: (item: T) => string;
  /** Texto contra el que se busca; por defecto, la etiqueta */
  getSearchText?: (item: T) => string;
  renderOption?: (item: T) => ReactNode;
  placeholder?: string;
  /** Lado preferido de la lista; si no entra, se abre del otro */
  direction?: "up" | "down";
  maxResults?: number;
  /** Clases extra de la lista: por ejemplo, que sea mas ancha que un campo angosto */
  listClassName?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
}

// Seleccion por busqueda, como la del equipo al crear un ticket: se escribe,
// aparecen las coincidencias y se elige una. Con algo elegido, el campo lo
// muestra; al enfocarlo queda marcado y lo que se escribe lo reemplaza. Salir
// sin elegir vuelve a mostrar lo elegido; borrar todo y salir lo quita.
export function SearchSelect<T>({
  id,
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSearchText = getLabel,
  renderOption,
  placeholder,
  direction = "down",
  maxResults = 8,
  listClassName,
  disabled,
  "aria-invalid": ariaInvalid,
}: SearchSelectProps<T>) {
  const { t } = useI18n();
  // null = no se esta buscando: el campo muestra lo elegido
  const [query, setQuery] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => getKey(item) === value) ?? null;

  // Cada palabra tiene que aparecer, en cualquier orden: "lab 2" encuentra "Laboratorio 2"
  const words = normalize(query ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const matches = words.length
    ? items.filter((item) => {
        const text = normalize(getSearchText(item));
        return words.every((w) => text.includes(w));
      })
    : [];
  const open = words.length > 0;
  const listId = id ? `${id}-options` : undefined;

  const choose = (item: T) => {
    onChange(getKey(item));
    // El foco sigue en el campo: lo elegido queda marcado para reemplazarlo escribiendo
    requestAnimationFrame(() => inputRef.current?.select());
    setQuery(null);
  };

  const finishSearch = () => {
    if (query === null) return;
    if (!query.trim() && value) onChange("");
    setQuery(null);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !next && setQuery(null)}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={setAnchor}>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-invalid={ariaInvalid}
            autoComplete="off"
            placeholder={placeholder ?? t("ui.search")}
            disabled={disabled}
            value={query ?? (selected ? getLabel(selected) : "")}
            onChange={(e) => setQuery(e.target.value)}
            // Lo elegido queda marcado (al entrar o al hacer clic): escribir lo reemplaza
            // sin tener que borrarlo
            onFocus={(e) => e.target.select()}
            onMouseUp={(e) => {
              if (query !== null) return;
              e.preventDefault();
              e.currentTarget.select();
            }}
            onBlur={finishSearch}
            onKeyDown={(e) => {
              // Enter elige la primera coincidencia en vez de enviar el formulario
              if (e.key === "Enter" && open) {
                e.preventDefault();
                if (matches[0]) choose(matches[0]);
              }
            }}
          />
        </div>
      </PopoverPrimitive.Anchor>
      {/* En un portal: la lista queda por encima de las tarjetas vecinas en vez de
          quedar tapada o recortada. Dentro de un modal se monta en el modal, para
          que su bloqueo de desplazamiento no le impida desplazarse */}
      <PopoverPrimitive.Portal container={anchor?.closest<HTMLElement>("[role=dialog]")}>
        <PopoverPrimitive.Content
          id={listId}
          role="listbox"
          side={direction === "up" ? "top" : "bottom"}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // El foco sigue en el campo para seguir escribiendo
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchor?.contains(e.target as Node)) e.preventDefault();
          }}
          className={cn(
            "z-50 min-w-[var(--radix-popover-trigger-width)] bg-popover border border-border rounded-xl shadow-lg overflow-y-auto",
            "max-h-[min(12rem,var(--radix-popover-content-available-height))]",
            listClassName,
          )}
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("ui.noResults")}</p>
          ) : (
            matches.slice(0, maxResults).map((item) => (
              <button
                key={getKey(item)}
                type="button"
                role="option"
                aria-selected={getKey(item) === value}
                className="w-full text-left px-3 py-2.5 text-base hover:bg-muted/50 transition-colors flex items-center gap-2 sm:py-2 sm:text-sm"
                // mousedown en vez de click: el foco no llega a salir del campo
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                {renderOption ? renderOption(item) : getLabel(item)}
              </button>
            ))
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
