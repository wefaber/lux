import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS } from "@/i18n";
import { useI18n } from "@/hooks/useI18n";

// Selector ES / EN: dos botones chicos, para la barra superior, el login y el perfil.
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className={cn("inline-flex items-center gap-1 rounded-full bg-muted p-0.5", className)}
    >
      <Languages className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          aria-label={t(`language.name.${code}`)}
          title={t(`language.name.${code}`)}
          lang={code}
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium uppercase transition-colors cursor-pointer",
            lang === code
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
