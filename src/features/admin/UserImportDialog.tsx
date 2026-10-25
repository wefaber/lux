import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { gql, errorMessage, cn } from "@/lib/utils";
import {
  downloadCsv,
  parseUserImportCsv,
  userImportTemplate,
  type UserImportParse,
} from "@/lib/csv";
import { translateError } from "@/i18n/errors";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const IMPORT_USERS_MUTATION = `
  mutation ImportUsers($rows: [UserImportRow!]!) {
    importUsers(rows: $rows) {
      created
      updated
      failed
      rows { line status userId error }
    }
  }
`;

export interface ImportRowResult {
  line: number;
  status: "created" | "updated" | "error" | string;
  userId: string | null;
  error: string | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

interface UserImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  created: "text-success",
  updated: "text-info",
  error: "text-destructive",
};

const STATUS_LABEL = {
  created: "admin.users.importStatus.created",
  updated: "admin.users.importStatus.updated",
  error: "admin.users.importStatus.error",
} as const;

// Importación masiva desde un CSV (lo que Excel exporta). El parseo y la
// validación por fila corren en el cliente para mostrar los errores antes de
// mandar nada; la API vuelve a validar y decide altas y actualizaciones.
export function UserImportDialog({ open, onOpenChange, onImported }: UserImportDialogProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<UserImportParse | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState("");
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFileName("");
    setParsed(null);
    setResult(null);
    setFileError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    setFileError("");
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setParsed(null);
      setFileError(t("admin.users.importOnlyCsv"));
      return;
    }
    setParsed(parseUserImportCsv(await file.text()));
  };

  const runImport = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setImporting(true);
    setFileError("");
    try {
      const data = await gql<{ importUsers: ImportResult }>(IMPORT_USERS_MUTATION, {
        rows: parsed.rows,
      });
      setResult(data.importUsers);
      if (data.importUsers.created + data.importUsers.updated > 0) onImported();
    } catch (err) {
      setFileError(errorMessage(err, t("admin.users.importFailed")));
    } finally {
      setImporting(false);
    }
  };

  const rowErrors = parsed?.errors ?? [];
  const canImport = Boolean(parsed && parsed.rows.length > 0 && !parsed.missingColumns.length);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("admin.users.importTitle")}</DialogTitle>
          <DialogDescription>{t("admin.users.importDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("admin.users.importHint")}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              id="user-import-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleFile}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {parsed || result ? t("admin.users.importAnother") : t("admin.users.importChoose")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadCsv("lux-plantilla-usuarios.csv", userImportTemplate())
              }
            >
              <Download className="h-3.5 w-3.5" />
              {t("admin.users.importTemplate")}
            </Button>
            {fileName && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[16rem]">{fileName}</span>
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{t("admin.users.importUpdatedHint")}</p>

          {parsed?.missingColumns.length ? (
            <ErrorAlert>
              {t("admin.users.importMissing", { columns: parsed.missingColumns.join(", ") })}
            </ErrorAlert>
          ) : null}

          {parsed && !parsed.missingColumns.length && (
            <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-foreground">
                  {t("admin.users.importReady", { count: parsed.rows.length })}
                </span>
                {rowErrors.length > 0 && (
                  <span className="text-destructive">
                    {t("admin.users.importRowErrors", { count: rowErrors.length })}
                  </span>
                )}
                {parsed.unknownColumns.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {parsed.unknownColumns.join(", ")}
                  </span>
                )}
              </div>
              {parsed.total === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("admin.users.importEmpty")}
                </p>
              )}
            </div>
          )}

          {rowErrors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              {rowErrors.map((error) => (
                <li key={`${error.line}-${error.message}`} className="text-destructive">
                  <span className="font-semibold">
                    {t("admin.users.importLine", { line: error.line })}:
                  </span>{" "}
                  {translateError(error.message)}
                </li>
              ))}
            </ul>
          )}

          <ErrorAlert>{fileError}</ErrorAlert>

          {result && (
            <div className="space-y-2">
              <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm font-medium">
                {t("admin.users.importResult", {
                  created: result.created,
                  updated: result.updated,
                  failed: result.failed,
                })}
                {result.failed === 0 && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    {t("admin.users.importDone")}
                  </span>
                )}
              </div>
              {result.failed > 0 && (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/70 px-3 py-2 text-xs">
                  {result.rows.map((row) => (
                    <li key={`${row.line}-${row.userId ?? "x"}`} className="flex gap-2">
                      <span className="shrink-0 font-semibold text-muted-foreground">
                        {t("admin.users.importLine", { line: row.line })}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-medium",
                          STATUS_STYLE[row.status] ?? "text-muted-foreground",
                        )}
                      >
                        {t(
                          STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] ??
                            STATUS_LABEL.error,
                        )}
                      </span>
                      {row.error && (
                        <span className="min-w-0 text-destructive">
                          {translateError(row.error)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canImport || importing}
            onClick={runImport}
          >
            {importing ? t("admin.users.importing") : t("admin.users.importRun")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
