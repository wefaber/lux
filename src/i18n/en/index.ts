import type { MessageKey } from "..";
import { core } from "./core";
import { domain } from "./domain";
import { errors } from "./errors";
import { validation } from "./validation";

// Ingles: tiene que tener exactamente las claves del espanol
export const en: Record<MessageKey, string> = {
  ...core,
  ...domain,
  ...errors,
  ...validation,
};
