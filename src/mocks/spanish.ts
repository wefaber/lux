import { plain, withLang } from "@/i18n";
import type { StatusConfig } from "@/lib/constants";
import * as validation from "@/lib/validation";

// El mock hace de API: igual que el backend real, responde siempre en espanol.
// El cliente traduce esos mensajes al idioma activo (src/i18n/errors.ts), asi
// el mock ejercita la misma ruta que la API de verdad. Las validaciones y las
// etiquetas que entran en un mensaje se generan entonces en espanol fijo, sin
// importar el idioma de la interfaz.

/** Etiqueta en espanol de un estado, para armar un mensaje de error. */
export function spanishLabel(config: StatusConfig): string {
  return plain(config.labelKey, "es");
}

type Fn<A extends unknown[], R> = (...args: A) => R;

function inSpanish<A extends unknown[], R>(fn: Fn<A, R>): Fn<A, R> {
  return (...args) => withLang("es", () => fn(...args));
}

export const validateComment = inSpanish(validation.validateComment);
export const validateComponent = inSpanish(validation.validateComponent);
export const validateIntervention = inSpanish(validation.validateIntervention);
export const validateLoan = inSpanish(validation.validateLoan);
export const validateLocation = inSpanish(validation.validateLocation);
export const validatePassword = inSpanish(validation.validatePassword);
export const validateProduct = inSpanish(validation.validateProduct);
export const validateReservation = inSpanish(validation.validateReservation);
export const validateServiceRequest = inSpanish(validation.validateServiceRequest);
export const validateTicket = inSpanish(validation.validateTicket);
export const validateUser = inSpanish(validation.validateUser);
