import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ComponentPropsWithoutRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

function DialogOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[6px]", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const { t } = useI18n();
  // Con prefers-reduced-motion el modal aparece y desaparece sin escala ni rebote
  const reduceMotion = useReducedMotion();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content asChild {...props}>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 350, damping: 28 }
          }
          className={cn(
            "fixed left-[50%] top-[50%] z-50 flex w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col",
            // En el telefono: margen a los costados y alto limitado a lo visible (dvh descuenta
            // las barras del navegador). El cuerpo se desplaza por dentro; cabecera y
            // acciones quedan quietas para que el cierre y el envio siempre se alcancen.
            "w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)]",
            "overflow-hidden rounded-2xl border border-border/50 bg-popover/90 shadow-2xl backdrop-blur-3xl",
            "focus:outline-none focus:ring-0",
            className,
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-0 sm:p-6 sm:pb-0">
            {children}
          </div>
          <DialogPrimitive.Close className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-popover/80 text-muted-foreground backdrop-blur-sm hover:bg-muted/70 hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer sm:right-4 sm:top-4">
            <X className="h-4 w-4" />
            <span className="sr-only">{t("ui.close")}</span>
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Queda pegado arriba al desplazar el cuerpo, con sitio para el boton de cierre
        "sticky top-0 z-10 -mx-4 -mt-4 mb-5 flex flex-col gap-2 border-b border-border/20 bg-popover/95 px-4 pb-3 pt-4 pe-12 backdrop-blur-xl sm:-mx-6 sm:-mt-6 sm:px-6 sm:pb-4 sm:pt-6 sm:pe-14",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-bold tracking-tight text-foreground/90", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground font-medium", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Acciones siempre a la vista: al pie del modal, no al final del contenido.
        // En el telefono siguen en una fila si entran (44px de alto) y bajan solas si no.
        "sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border/20 bg-popover/95 px-4 pb-4 pt-3 backdrop-blur-xl sm:-mx-6 sm:px-6 sm:pb-5 sm:pt-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  AnimatePresence,
};
