import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import type { FontSize } from "@/lib/types";

const sizes: { label: string; value: FontSize }[] = [
  { label: "A", value: "sm" },
  { label: "A", value: "md" },
  { label: "A", value: "lg" },
  { label: "A", value: "xl" },
];

export function FontSizeControl() {
  const { fontSize, setFontSize } = useTheme();
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {sizes.map((s, i) => (
        <button
          key={s.value}
          onClick={() => setFontSize(s.value)}
          aria-label={t(`a11y.fontSize.${s.value}`)}
          className={`rounded-lg px-2 py-1 transition-colors cursor-pointer ${
            fontSize === s.value
              ? "bg-black/10 dark:bg-white/15 text-foreground"
              : "text-muted-foreground hover:text-foreground dark:hover:text-white hover:bg-muted/50"
          }`}
          style={{ fontSize: `${10 + i * 2}px`, fontWeight: 500 }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export { Button };

// Boton de seleccion de size de fuente
