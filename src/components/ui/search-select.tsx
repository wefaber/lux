import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// "salon" encuentra "Salón": se compara sin mayusculas ni tildes
function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

interface SearchSelectProps<T> {
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
  /** La lista se abre hacia arriba cuando el campo esta al final de un formulario */
  direction?: "up" | "down";
  maxResults?: number;
  /** Clases extra de la lista: por ejemplo, que sea mas ancha que un campo angosto */
  listClassName?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
}

// Seleccion por busqueda, como la del equipo al crear un ticket: se escribe,
// aparecen las coincidencias y se elige una. Con algo elegido, el campo lo
// muestra; al volver a enfocarlo se limpia para buscar otra vez.
export function SearchSelect<T>({
  id,
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSearchText = getLabel,
  renderOption,
  placeholder = "Buscar...",
  direction = "down",
  maxResults = 8,
  listClassName,
  disabled,
  "aria-invalid": ariaInvalid,
}: SearchSelectProps<T>) {
  const [query, setQuery] = useState("");
  const selected = items.find((item) => getKey(item) === value) ?? null;

  // Cada palabra tiene que aparecer, en cualquier orden: "lab 2" encuentra "Laboratorio 2"
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const term = words.join(" ");
  const matches = term
    ? items.filter((item) => {
        const text = normalize(getSearchText(item));
        return words.every((w) => text.includes(w));
      })
    : [];
  const open = Boolean(term) && !selected;
  const listId = id ? `${id}-options` : undefined;

  const choose = (item: T) => {
    onChange(getKey(item));
    setQuery("");
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={ariaInvalid}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={selected ? getLabel(selected) : query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value) onChange("");
        }}
        onFocus={() => {
          if (selected) {
            onChange("");
            setQuery("");
          }
        }}
        onKeyDown={(e) => {
          // Enter elige la primera coincidencia en vez de enviar el formulario
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (matches[0]) choose(matches[0]);
          }
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute z-50 left-0 right-0 bg-popover border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto",
            direction === "up" ? "bottom-full mb-1" : "top-full mt-1",
            listClassName,
          )}
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</p>
          ) : (
            matches.slice(0, maxResults).map((item) => (
              <button
                key={getKey(item)}
                type="button"
                role="option"
                aria-selected={false}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                // mousedown en vez de click: el foco no llega a salir del campo
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                {renderOption ? renderOption(item) : getLabel(item)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
