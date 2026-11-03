import { useEffect, useRef, useCallback, useState, type FormEvent } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, Keyboard, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/ui/error-alert";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

type CameraProblem = "denied" | "unavailable" | "insecure" | null;

// Por que no hay camara: permiso negado, contexto sin HTTPS o sin dispositivo
function classifyCameraError(err: unknown): CameraProblem {
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure";
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  return "unavailable";
}

interface ManualEntryProps {
  onSubmit: (value: string) => void;
}

// Plan B sin camara: se tipea el ID de maquina (L1-PC3)
function ManualEntry({ onSubmit }: ManualEntryProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (code) onSubmit(code);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <Label htmlFor="qr-manual" className="flex items-center gap-1.5">
        <Keyboard className="h-3.5 w-3.5" />
        {t("ui.qr.manualLabel")}
      </Label>
      <div className="flex gap-2">
        <Input
          id="qr-manual"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder={t("ui.qr.manualPlaceholder")}
          className="flex-1 font-mono"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
        />
        <Button type="submit" disabled={!value.trim()}>
          {t("ui.qr.manualSubmit")}
        </Button>
      </div>
    </form>
  );
}

interface QrViewportProps {
  onCode: (value: string) => void;
  onProblem: (problem: CameraProblem) => void;
  className?: string;
}

// Camara + lectura de cuadros con jsQR. Se monta para escanear y se desmonta
// para apagar la camara.
function QrViewport({ onCode, onProblem, className }: QrViewportProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scannedRef = useRef(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || scannedRef.current) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    if (code) {
      scannedRef.current = true;
      stopCamera();
      onCode(code.data);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onCode, stopCamera]);

  useEffect(() => {
    let cancelled = false;
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      onProblem(
        typeof window !== "undefined" && window.isSecureContext === false
          ? "insecure"
          : "unavailable",
      );
      return;
    }
    devices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        return video.play().then(() => {
          rafRef.current = requestAnimationFrame(tick);
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) onProblem(classifyCameraError(err));
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [tick, stopCamera, onProblem]);

  return (
    <div className={cn("relative rounded-xl overflow-hidden bg-black aspect-square", className)}>
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-48 h-48 border-2 border-white/70 rounded-xl" />
      </div>
      <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80">
        {t("ui.qr.hint")}
      </p>
    </div>
  );
}

function CameraProblemAlert({ problem }: { problem: Exclude<CameraProblem, null> }) {
  const { t } = useI18n();
  return (
    <ErrorAlert>
      <span className="flex items-start gap-2">
        <CameraOff className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t(`ui.qr.problem.${problem}`)}</span>
      </span>
    </ErrorAlert>
  );
}

interface QrScannerProps {
  /** dialog (por defecto): ventana modal. page: pantalla completa, sin ventana. */
  variant?: "dialog" | "page";
  /** Solo en la ventana modal */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onScan: (value: string) => void;
}

export function QrScanner({
  variant = "dialog",
  open = true,
  onOpenChange,
  onScan,
}: QrScannerProps) {
  const { t } = useI18n();
  const [problem, setProblem] = useState<CameraProblem>(null);

  const handleProblem = useCallback((next: CameraProblem) => setProblem(next), []);

  if (variant === "page") {
    return (
      <div className="space-y-4">
        {problem ? (
          <CameraProblemAlert problem={problem} />
        ) : (
          <QrViewport
            onCode={onScan}
            onProblem={handleProblem}
            className="mx-auto w-full max-w-sm"
          />
        )}
        <ManualEntry onSubmit={onScan} />
      </div>
    );
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) setProblem(null);
    onOpenChange?.(next);
  };
  const handleCode = (value: string) => {
    onScan(value);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            {t("ui.qr.title")}
          </DialogTitle>
          <DialogDescription>{t("ui.qr.description")}</DialogDescription>
        </DialogHeader>
        {problem ? (
          <>
            <CameraProblemAlert problem={problem} />
            <ManualEntry onSubmit={handleCode} />
          </>
        ) : (
          <QrViewport onCode={handleCode} onProblem={handleProblem} />
        )}
        <DialogFooter>
          <Button
            className="max-sm:w-full"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
