import { useAsync } from "@/hooks/useSkeleton";
import { gql } from "@/lib/utils";
import type { Location } from "@/lib/types";

export const LOCATIONS_QUERY = `
  query GetLocations {
    locations { id name code productCount createdAt updatedAt deletedAt }
  }
`;

// Ubicaciones vigentes, para filtros y formularios. Antes eran una lista fija
// en el codigo; ahora las administra el staff desde Ubicaciones.
export function useLocations() {
  const { data, isLoading, error, refetch } = useAsync<{ locations: Location[] }>(
    () => gql(LOCATIONS_QUERY),
    [],
  );
  return { locations: data?.locations ?? [], isLoading, error, refetch };
}
