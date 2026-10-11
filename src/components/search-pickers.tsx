import { ROLE_LABELS } from "@/lib/constants";
import type { Location, Product, User } from "@/lib/types";
import { SearchSelect, type SearchSelectProps } from "@/components/ui/search-select";

// Buscadores de cada tipo de dato, para que el mismo dato se vea y se busque
// igual en todas las pantallas. Cada pantalla solo pone la lista y el valor.
type PickerProps<T> = Omit<
  SearchSelectProps<T>,
  "getKey" | "getLabel" | "getSearchText" | "renderOption"
>;

/** Del asignado de una solicitud solo se conocen el id y el nombre */
export type UserOption = Pick<User, "id" | "name"> & Partial<Pick<User, "dni" | "role">>;

// Por nombre o cedula: la cedula resaltada, el nombre y el rol a la derecha
export function UserSearchSelect(props: PickerProps<UserOption>) {
  return (
    <SearchSelect
      placeholder="Buscar por nombre o cédula..."
      {...props}
      getKey={(u) => u.id}
      getLabel={(u) => (u.dni ? `${u.dni} · ${u.name}` : u.name)}
      getSearchText={(u) => `${u.name} ${u.dni ?? ""}`}
      renderOption={(u) => (
        <>
          {u.dni && <span className="font-mono text-xs text-primary font-semibold">{u.dni}</span>}
          <span className="text-muted-foreground">{u.name}</span>
          {u.role && (
            <span className="ml-auto pl-4 text-xs text-muted-foreground">
              {ROLE_LABELS[u.role]}
            </span>
          )}
        </>
      )}
    />
  );
}

// Por ID, tipo, marca, modelo o ubicacion: "L1-PC3", "proyector", "Laboratorio 1"
export function EquipmentSearchSelect(props: PickerProps<Product>) {
  return (
    <SearchSelect
      placeholder="Buscar: proyector, L1-PC3, Laboratorio 1..."
      {...props}
      getKey={(p) => p.id}
      getLabel={(p) => `${p.machineId} · ${p.brand} ${p.model}`}
      getSearchText={(p) => `${p.machineId} ${p.kind} ${p.brand} ${p.model} ${p.location}`}
      renderOption={(p) => (
        <>
          <span className="font-mono text-xs text-primary font-semibold">{p.machineId}</span>
          <span className="text-muted-foreground">
            {p.brand} {p.model}
          </span>
          <span className="ml-auto pl-4 text-xs text-muted-foreground">{p.location}</span>
        </>
      )}
    />
  );
}

// Cualquier ubicacion, por nombre o codigo: "laboratorio 2", "L2"
export function LocationSearchSelect(props: PickerProps<Location>) {
  return (
    <SearchSelect
      placeholder="Buscar: laboratorio 2, L2..."
      {...props}
      getKey={(l) => l.id}
      getLabel={locationLabel}
      renderOption={renderLocation}
    />
  );
}

// Solo laboratorios. La clave es su numero (Laboratorio 3 = "3"), que es lo que
// guarda una solicitud de preparacion de laboratorio
export function LabSearchSelect({ items, ...props }: PickerProps<Location>) {
  return (
    <SearchSelect
      placeholder="Buscar: laboratorio 2, L2..."
      {...props}
      items={items.filter((l) => l.kind === "laboratory")}
      getKey={(l) => String(l.number)}
      getLabel={locationLabel}
      renderOption={renderLocation}
    />
  );
}

function locationLabel(l: Location): string {
  return `${l.name} (${l.code})`;
}

function renderLocation(l: Location) {
  return (
    <>
      <span className="font-mono text-xs text-primary font-semibold">{l.code}</span>
      <span className="text-foreground">{l.name}</span>
    </>
  );
}
