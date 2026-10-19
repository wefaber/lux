// Forma del diccionario en otro idioma: las mismas claves que el espanol, todas
// con texto. Una clave que falta o sobra rompe el typecheck.
export type Translation<T> = { [K in keyof T]: string };
