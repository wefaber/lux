import { describe, expect, test } from "bun:test";
import { mockComments } from "./data/comments";
import { mockTickets } from "./data/tickets";
import { mockServices } from "./data/services";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { Comment } from "@/lib/types";

useMockServer();

const { TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;

const LIST = `query GetComments($entityType: String!, $entityId: ID!) { comments(entityType: $entityType, entityId: $entityId) { id body createdAt author { id } } }`;
const CREATE = `mutation CreateComment($input: CommentInput!) { createComment(input: $input) { id } }`;

// Un ticket y una solicitud del SOLICITANTE, para no depender de ids puntuales
const ownTicket = mockTickets.find((t) => t.submittedBy.id === SOLICITANTE)!;
const ownService = mockServices.find((s) => s.requestedBy.id === SOLICITANTE)!;

function comment(id: string): Comment {
  return mockComments.find((c) => c.id === id)!;
}

async function post(as: string, entityType: string, entityId: string, body: string) {
  return gqlAs<{ createComment: { id: string } }>(as, CREATE, {
    input: { entityType, entityId, body },
  });
}

describe("#21 comentar tickets y solicitudes", () => {
  test("el solicitante comenta su ticket y el técnico le responde en el mismo hilo", async () => {
    const mine = await post(SOLICITANTE, "ticket", ownTicket.id, "  ¿Hay novedades?  ");
    expect(mine.errors).toBeUndefined();
    expect(comment(mine.data!.createComment.id)).toMatchObject({
      body: "¿Hay novedades?",
      entityType: "ticket",
      entityId: ownTicket.id,
    });
    expect(comment(mine.data!.createComment.id).author.id).toBe(SOLICITANTE);

    expect((await post(TECNICO, "ticket", ownTicket.id, "Mañana lo reviso")).errors).toBeUndefined();

    const thread = await gqlAs<{ comments: Array<{ body: string; createdAt: string }> }>(
      SOLICITANTE,
      LIST,
      { entityType: "ticket", entityId: ownTicket.id },
    );
    const bodies = thread.data!.comments.map((c) => c.body);
    expect(bodies.slice(-2)).toEqual(["¿Hay novedades?", "Mañana lo reviso"]);
    const dates = thread.data!.comments.map((c) => c.createdAt);
    expect(dates).toEqual(dates.toSorted());
  });

  test("el solicitante comenta su solicitud de servicio", async () => {
    const res = await post(SOLICITANTE, "service_request", ownService.id, "Gracias");
    expect(res.errors).toBeUndefined();
  });

  test("nadie lee ni escribe en el hilo de un ticket ajeno salvo el staff", async () => {
    const other = mockTickets.find((t) => t.submittedBy.id !== OTRO_SOLICITANTE)!;
    expect(
      (await gqlAs(OTRO_SOLICITANTE, LIST, { entityType: "ticket", entityId: other.id }))
        .errors?.[0].message,
    ).toBe(FORBIDDEN);
    expect((await post(OTRO_SOLICITANTE, "ticket", other.id, "Hola")).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect(
      (await gqlAs(TECNICO, LIST, { entityType: "ticket", entityId: other.id })).errors,
    ).toBeUndefined();
  });

  test("no acepta comentarios vacíos ni sobre algo que no existe", async () => {
    expect((await post(SOLICITANTE, "ticket", ownTicket.id, "   ")).errors?.[0].message).toBe(
      "El comentario no puede estar vacío",
    );
    expect((await post(TECNICO, "ticket", "tkt-999", "Hola")).errors?.[0].message).toBe(
      "No encontrado",
    );
    expect((await post(TECNICO, "loan", "loan-001", "Hola")).errors?.[0].message).toBe(
      "No encontrado",
    );
  });
});
