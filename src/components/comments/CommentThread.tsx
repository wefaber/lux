import { useState, type FormEvent, type KeyboardEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql, formatDateTime, cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import { isStaff } from "@/lib/roles";
import { validateComment } from "@/lib/validation";
import type { Comment, CommentEntity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COMMENTS_QUERY = `
  query GetComments($entityType: String!, $entityId: ID!) {
    comments(entityType: $entityType, entityId: $entityId) {
      id entityType entityId body createdAt
      author { id name role }
    }
  }
`;
const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CommentInput!) { createComment(input: $input) { id } }
`;

interface CommentThreadProps {
  entityType: CommentEntity;
  entityId: string;
}

// Hilo de un ticket o solicitud: el canal entre quien lo abrio y el staff
export function CommentThread({ entityType, entityId }: CommentThreadProps) {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useAsync<{ comments: Comment[] }>(
    () => gql(COMMENTS_QUERY, { entityType, entityId }),
    [entityType, entityId],
  );
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const comments = data?.comments ?? [];

  const send = async () => {
    const invalid = validateComment(body);
    if (invalid) {
      setSendError(invalid);
      return;
    }
    setSending(true);
    setSendError("");
    try {
      await gql(CREATE_COMMENT_MUTATION, { input: { entityType, entityId, body } });
      setBody("");
      refetch();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "No se pudo enviar el comentario");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  // Ctrl/Cmd + Enter envia; Enter solo agrega un renglon
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Comentarios ({comments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !data ? (
          <div className="space-y-2">
            {["a", "b"].map((k) => (
              <div key={k} className="h-14 rounded-xl bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Error al cargar los comentarios: {error}</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay comentarios. Usá este espacio para consultas o novedades.
          </p>
        ) : (
          <ol className="space-y-2" aria-label="Comentarios">
            {comments.map((c) => {
              const mine = c.author.id === user?.id;
              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-xl border p-3 space-y-1",
                    mine ? "border-primary/20 bg-primary/5" : "border-border/70",
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      {mine ? "Vos" : c.author.name}
                    </span>
                    {isStaff(c.author.role) && (
                      <Badge color="info">{ROLE_LABELS[c.author.role]}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-line break-words">
                    {c.body}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            aria-label="Escribir un comentario"
            placeholder="Escribí un comentario..."
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSendError("");
            }}
            onKeyDown={handleKeyDown}
            maxLength={1000}
            className="h-20"
          />
          <div className="flex items-center justify-between gap-3">
            <p className={cn("text-xs", sendError ? "text-destructive" : "text-muted-foreground")}>
              {sendError || "Ctrl + Enter para enviar"}
            </p>
            <Button type="submit" size="sm" disabled={sending || !body.trim()}>
              <Send className="h-3.5 w-3.5" />
              {sending ? "Enviando..." : "Comentar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
