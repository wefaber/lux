import * as ProgressPrimitive from "@radix-ui/react-progress";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative h-2.5 w-full overflow-hidden rounded-full bg-muted/60 border border-border/30 shadow-2xs backdrop-blur-md",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-gradient-to-r from-secondary via-primary to-primary text-primary-foreground transition-all duration-700 motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
