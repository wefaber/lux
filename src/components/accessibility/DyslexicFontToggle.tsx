import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

// Interruptor de la fuente para dislexia: lo comparten el perfil y la guia.
export function DyslexicFontToggle() {
  const { dyslexicFont, toggleDyslexicFont } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dyslexicFont}
      aria-label={t("profile.a11y.dyslexic")}
      onClick={toggleDyslexicFont}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        dyslexicFont ? "bg-primary" : "bg-black/20 dark:bg-card/20",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none",
          dyslexicFont && "translate-x-5",
        )}
      />
    </button>
  );
}
