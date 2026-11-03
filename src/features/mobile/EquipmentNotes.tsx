import { useEffect, useRef, useState } from "react";
import { CloudUpload, Check, Loader2, NotebookPen, Plus, Trash2 } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, formatDateTime, gql } from "@/lib/utils";
import { newClientId, sendOrQueue } from "@/lib/outbox";
import type { EquipmentNote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Textarea } from "@/components/ui/textarea";
import { DELETE_NOTE_MUTATION, MY_NOTES_QUERY, UPSERT_NOTE_MUTATION } from "./queries";

const AUTOSAVE_MS = 800;
const NOTE_MAX = 2000;

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

interface NoteEditorProps {
  productId: string;
  /** Nota existente; sin ella se crea una al escribir */
  note?: EquipmentNote;
  autoFocus?: boolean;
  onDeleted: (id: string) => void;
}

// Editor de una nota privada con autoguardado. Escribir (con pausa de 800 ms)
// manda `upsertEquipmentNote` por la cola offline: sin red queda guardada en el
// telefono y sale al volver la conexion.
function NoteEditor({ productId, note, autoFocus, onDeleted }: NoteEditorProps) {
  const { t } = useI18n();
  const [body, setBody] = useState(note?.body ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  // Identidad estable de la nota: el id del servidor cuando ya existe y, antes,
  // el clientId que hace idempotente el alta si se reintenta
  const idRef = useRef(note?.id);
  const clientIdRef = useRef(newClientId());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestRef = useRef(body);
  const lastSavedRef = useRef(note?.body ?? "");
  // Los guardados salen de a uno, en orden: el segundo ya conoce el id del primero
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const save = () => {
    clearTimeout(timerRef.current);
    const text = latestRef.current.trim();
    if (!text || text === lastSavedRef.current) return;
    setState("saving");
    chainRef.current = chainRef.current.then(async () => {
      try {
        const id = idRef.current;
        const result = await sendOrQueue<{ upsertEquipmentNote: EquipmentNote }>({
          op: "UpsertEquipmentNote",
          query: UPSERT_NOTE_MUTATION,
          clientId: clientIdRef.current,
          key: `note:${id ?? clientIdRef.current}`,
          variables: {
            input: { id, productId, body: text, clientId: clientIdRef.current },
          },
        });
        lastSavedRef.current = text;
        setError("");
        if (result.status === "sent") {
          idRef.current = result.data.upsertEquipmentNote.id;
          // Si mientras tanto se siguio escribiendo, ese texto tiene su propio guardado
          setState(latestRef.current.trim() === text ? "saved" : "saving");
        } else {
          setState("queued");
        }
      } catch (err) {
        setState("error");
        setError(errorMessage(err, t("mobile.notes.saveFailed")));
      }
    });
  };

  // Al salir de la pantalla no se pierde lo escrito: se guarda lo pendiente
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => saveRef.current(), []);

  const handleChange = (value: string) => {
    setBody(value);
    latestRef.current = value;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_MS);
  };

  const handleDelete = async () => {
    clearTimeout(timerRef.current);
    const id = idRef.current;
    if (!id) {
      onDeleted("");
      return;
    }
    try {
      await gql(DELETE_NOTE_MUTATION, { id });
      onDeleted(id);
    } catch (err) {
      setState("error");
      setError(errorMessage(err, t("mobile.notes.deleteFailed")));
    }
  };

  const status =
    state === "saving" ? (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("mobile.notes.saving")}
      </span>
    ) : state === "saved" ? (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="h-3 w-3" />
        {t("mobile.notes.saved")}
      </span>
    ) : state === "queued" ? (
      <span className="inline-flex items-center gap-1 text-warning">
        <CloudUpload className="h-3 w-3" />
        {t("mobile.notes.queued")}
      </span>
    ) : note ? (
      formatDateTime(note.updatedAt)
    ) : null;

  return (
    <Card className="hover:translate-y-0">
      <CardContent className="space-y-2 p-3">
        <Textarea
          value={body}
          maxLength={NOTE_MAX}
          autoFocus={autoFocus}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={save}
          placeholder={t("mobile.notes.placeholder")}
          aria-label={t("mobile.notes.label")}
          className="h-24"
        />
        <ErrorAlert>{error}</ErrorAlert>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">{status}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDelete()}
            aria-label={t("mobile.notes.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Notas privadas del tecnico sobre un equipo: solo las ve su autor
export function EquipmentNotes({ productId }: { productId: string }) {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useAsync<{ myEquipmentNotes: EquipmentNote[] }>(
    () => gql(MY_NOTES_QUERY, { productId }),
    [productId],
  );
  // Notas nuevas que se estan escribiendo (aun sin id del servidor)
  const [drafts, setDrafts] = useState<string[]>([]);

  const notes = data?.myEquipmentNotes ?? [];

  return (
    <section aria-label={t("mobile.notes.title")} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <NotebookPen className="h-4 w-4" />
          {t("mobile.notes.title")}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDrafts((d) => [...d, newClientId()])}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("mobile.notes.add")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("mobile.notes.private")}</p>
      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}
      {isLoading && !data && <p className="text-xs text-muted-foreground">{t("common.loading")}</p>}
      {drafts.map((draftId) => (
        <NoteEditor
          key={draftId}
          productId={productId}
          autoFocus
          onDeleted={() => setDrafts((d) => d.filter((x) => x !== draftId))}
        />
      ))}
      {notes.map((note) => (
        <NoteEditor key={note.id} productId={productId} note={note} onDeleted={() => refetch()} />
      ))}
      {!isLoading && notes.length === 0 && drafts.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">{t("mobile.notes.empty")}</p>
      )}
    </section>
  );
}
