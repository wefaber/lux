// Idempotencia de los reintentos offline: clave "<coleccion>:<autorId>:<clientId>"
// -> id del registro creado con ese clientId. Se guarda con los demas datos de
// prueba para que un reintento tras recargar la pagina no duplique nada.
export const mockClientKeys: Record<string, string> = {};
