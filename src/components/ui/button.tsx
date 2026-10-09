import { type ButtonHTMLAttributes, forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary/95 to-primary text-primary-foreground shadow-[0_2px_4px_rgba(22,60,131,0.08),0_4px_12px_rgba(22,60,131,0.12)] hover:from-primary hover:to-primary/90 hover:shadow-[0_4px_16px_rgba(22,60,131,0.2)] active:scale-[0.96]",
        secondary:
          "bg-card text-foreground border border-border/80 shadow-2xs hover:bg-muted/70 hover:border-border hover:shadow-xs active:scale-[0.96]",
        ghost:
          "bg-transparent text-foreground hover:bg-muted hover:text-foreground active:scale-[0.96]",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/20 shadow-2xs hover:bg-destructive/15 active:scale-[0.96]",
        info: "bg-info-bg text-info border border-info-border shadow-2xs hover:bg-info-bg/85 active:scale-[0.96]",
        success:
          "bg-success-bg text-success border border-success-border shadow-2xs hover:bg-success/20 active:scale-[0.96]",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-base rounded-2xl",
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
); // Variaciones de botones con sus respectivas clases

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
