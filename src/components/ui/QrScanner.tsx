import { useEffect, useRef, useCallback } from "react";
import jsQR from "jsqr";
import { Camera, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface QrScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
}

export function QrScanner({ open, onOpenChange, onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scannedRef = useRef(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    scannedRef.current = false;
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    if (code) {
      scannedRef.current = true;
      stopCamera();
      onScan(code.data);
      onOpenChange(false);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onScan, onOpenChange, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => {
            rafRef.current = requestAnimationFrame(tick);
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, tick, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Escanear QR del equipo
          </DialogTitle>
          <DialogDescription>Apuntá la cámara al código QR pegado en el equipo.</DialogDescription>
        </DialogHeader>
        <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-white/70 rounded-xl" />
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80">
            Apuntá la cámara al código QR del equipo
          </p>
        </div>
        <Button className="mt-5" variant="secondary" onClick={() => onOpenChange(false)}>
          <X className="h-3.5 w-3.5" />
          Cancelar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
