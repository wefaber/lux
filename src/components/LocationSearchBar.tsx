import { useId, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Location } from "@/lib/types";
import { normalize } from "@/components/ui/search-select";
import { useI18n } from "@/hooks/useI18n";

// Ubicaciones sugeridas a la vez
const MAX_SUGGESTIONS = 6;

interface LocationSearchBarProps {
  search: string;
  onSearchChange: (search: string) => void;
  locations: Location[];
  /** id de la ubicacion elegida; "" = todas */
  locationId: string;
  onLocationChange: (locationId: string) => void;
  placeholder?: string;
  className?: string;
}

// Barra de busqueda que tambien filtra por ubicacion: al escribir "lab 2" o "L2"
// se sugiere la ubicacion y, al elegirla, queda como etiqueta dentro de la barra.
// Reemplaza al desplegable de ubicaciones, que se vuelve largo cuando hay muchas.
export function LocationSearchBar({
  search,
  onSearchChange,
  locations,
  locationId,
  onLocationChange,
  placeholder,
  className,
}: LocationSearchBarProps) {
  const { t } = useI18n();
  const defaultPlaceholder = placeholder ?? t("locationSearch.placeholder");
  const listId = useId();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  // Escape, salir del campo o elegir cierran las sugerencias hasta que se vuelva a escribir
  const [dismissed, setDismissed] = useState(false);
  const selected = locations.find((l) => l.id === locationId) ?? null;

  const words = normalize(search).split(/\s+/).filter(Boolean);
  const suggestions = words.length
    ? locations
        .filter((l) => l.id !== locationId)
        .filter((l) => {
          const text = normalize(`${l.name} ${l.code}`);
          return words.every((w) => text.includes(w));
        })
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const open = suggestions.length > 0 && !dismissed;

  const choose = (loc: Location) => {
    onLocationChange(loc.id);
    // Lo escrito sirvio para encontrar la ubicacion, no para filtrar los equipos
    onSearchChange("");
    setDismissed(true);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !next && setDismissed(true)}>
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={setAnchor}
          className={cn(
            "flex h-10 items-center gap-2 rounded-xl border border-border/80 bg-card/45 px-3 text-sm shadow-2xs backdrop-blur-xs",
            "transition-all duration-300 ease-out hover:border-border hover:bg-card/65",
            "focus-within:border-primary focus-within:bg-card/85 focus-within:ring-4 focus-within:ring-primary/10",
            className,
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          {selected && (
            <span className="flex shrink-0 items-center gap-1 rounded-lg bg-info-bg pl-2 pr-1 py-0.5 text-xs font-medium text-primary">
              <MapPin className="h-3 w-3" />
              <span className="max-w-32 truncate">{selected.name}</span>
              <button
                type="button"
                aria-label={t("locationSearch.remove", { name: selected.name })}
                className="rounded-md p-0.5 hover:bg-primary/10 cursor-pointer"
                onClick={() => onLocationChange("")}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          <input
            data-bare-input
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-label={defaultPlaceholder}
            autoComplete="off"
            placeholder={selected ? t("locationSearch.inLocation") : defaultPlaceholder}
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setDismissed(false);
            }}
            onBlur={() => setDismissed(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && open) {
                e.preventDefault();
                choose(suggestions[0]);
              } else if (e.key === "Backspace" && !search && selected) {
                // Borrar con el campo vacio quita la etiqueta, como en un campo de correo
                onLocationChange("");
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={listId}
          role="listbox"
          aria-label={t("locationSearch.list")}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchor?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-50 min-w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg"
        >
          <p className="px-3 pt-2 pb-1 text-xs uppercase tracking-widest text-muted-foreground">
            {t("locationSearch.filterBy")}
          </p>
          {suggestions.map((l) => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              // mousedown en vez de click: el foco no llega a salir del campo
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(l)}
            >
              <span className="font-mono text-xs font-semibold text-primary">{l.code}</span>
              <span className="text-foreground">{l.name}</span>
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
