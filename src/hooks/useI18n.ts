import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  LOCALES,
  getLang,
  isLang,
  setLang,
  subscribeLang,
  syncDocumentLang,
  translate,
  type Lang,
  type TFunction,
} from "@/i18n";

interface I18nContextType {
  lang: Lang;
  /** Locale de Intl del idioma activo (es-UY, en-GB) */
  locale: string;
  setLang: (lang: Lang) => void;
  t: TFunction;
} // Interfaz de contexto de idioma

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLang, () => DEFAULT_LANG);

  // <html lang> sigue al idioma (lectores de pantalla, corrector, guiones)
  useEffect(() => {
    syncDocumentLang();
  }, [lang]);

  // El idioma se comparte entre pestañas, como la sesion
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANG_STORAGE_KEY && isLang(event.newValue)) setLang(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<I18nContextType>(
    () => ({
      lang,
      locale: LOCALES[lang],
      setLang,
      t: ((key, ...args) => translate(lang, key, ...args)) as TFunction,
    }),
    [lang],
  );

  // El key remonta el arbol al cambiar de idioma: los textos que salen de
  // constantes y utilidades (no de este contexto) se vuelven a calcular. El
  // costo es perder el estado local de la pantalla (ver docs/I18N.md).
  return createElement(
    I18nContext.Provider,
    { value },
    createElement(Fragment, { key: lang }, children),
  );
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
