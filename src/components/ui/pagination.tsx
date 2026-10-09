import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  /** Pagina actual, desde 0 */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Pagina actual acotada a las que existen: si un filtro deja menos, queda en la ultima */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
}

// "Mostrando 1–10 de 23" con Anterior / Siguiente. No se muestra si todo entra
// en una pagina.
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        Mostrando {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </Button>
        <span className="tabular-nums">
          {page + 1} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
