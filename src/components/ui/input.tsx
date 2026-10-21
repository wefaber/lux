import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 16px en el telefono: menos de eso hace que iOS acerque la pagina al enfocar
          "flex h-11 w-full rounded-xl border border-border/80 bg-card/45 px-3.5 py-2 text-base text-foreground placeholder:text-muted-foreground/75 shadow-2xs backdrop-blur-xs sm:h-10 sm:text-sm",
          "transition-all duration-300 ease-out",
          "hover:border-border hover:bg-card/65",
          "focus:outline-none focus:border-primary focus:bg-card/85 focus:ring-4 focus:ring-primary/10 focus:shadow-xs",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-muted/30",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
