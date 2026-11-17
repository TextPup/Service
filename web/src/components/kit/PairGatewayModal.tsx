import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { X, ShieldCheck, CheckCircle2, RefreshCw, Radio } from "lucide-react";

interface PairGatewayModalProps {
  isOpen: boolean;
  onClose: () => void;
  isHostOnline?: boolean;
}

export const PairGatewayModal: React.FC<PairGatewayModalProps> = ({
  isOpen,
  onClose,
  isHostOnline = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [qrPayload, setQrPayload] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [pairedSuccess, setPairedSuccess] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fetchPairingQr = async () => {
    setLoading(true);
    setPairedSuccess(false);
    try {
      const res = await fetch("/api/gateway/pair-qr");
      if (res.ok) {
        const data = await res.json();
        setServerUrl(data.serverUrl);
        setQrPayload(data.qrPayload);
        setExpiresAt(data.expiresAt);
        setTimeLeft(Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000)));
      }
    } catch (err) {
      console.error("Failed to fetch pairing QR code", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPairingQr();
    }
  }, [isOpen]);

  // Render QR Canvas
  useEffect(() => {
    if (!loading && qrPayload && canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        qrPayload,
        {
          width: 240,
          margin: 2,
          color: {
            dark: "#0F172A",
            light: "#FFFFFF",
          },
        },
        (error) => {
          if (error) console.error("QR Code generation error", error);
        }
      );
    }
  }, [loading, qrPayload]);

  // Countdown timer
  useEffect(() => {
    if (!isOpen || expiresAt === 0) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, expiresAt]);

  // Detect live connection
  useEffect(() => {
    if (isHostOnline && !pairedSuccess) {
      setPairedSuccess(true);
      const timer = setTimeout(() => {
        onClose();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isHostOnline, pairedSuccess, onClose]);

  if (!isOpen) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border-subtle shadow-2xl p-6 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Pair TextPup Host</h2>
            <p className="text-xs text-text-muted">Direct local air-gap radio connection</p>
          </div>
        </div>

        {/* Content Body */}
        {pairedSuccess ? (
          <div className="py-8 flex flex-col items-center text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-base font-bold text-text-primary">Host Phone Paired!</h3>
            <p className="text-sm text-text-muted mt-1 max-w-xs">
              Your cellular radios and Dual-SIM profile are now synchronized in real-time.
            </p>
          </div>
        ) : (
          <div>
            {/* QR Container */}
            <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-surface border border-border-subtle mb-4">
              {loading ? (
                <div className="w-[240px] h-[240px] flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : (
                <div className="relative p-2 bg-white rounded-xl shadow-md">
                  <canvas ref={canvasRef} className="rounded-lg" />
                </div>
              )}

              {/* Expiration Timer & Refresh */}
              <div className="flex items-center justify-between w-full mt-4 pt-3 border-t border-border-subtle text-xs text-text-muted">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Expires in {minutes}:{seconds < 10 ? `0${seconds}` : seconds}
                </span>
                <button
                  onClick={fetchPairingQr}
                  className="flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>
            </div>

            {/* Instruction Checklist */}
            <div className="space-y-2.5 text-xs text-text-secondary bg-surface-elevated/60 p-3.5 rounded-xl border border-border-subtle mb-5">
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">
                  1
                </span>
                <span>Open the <strong>TextPup Host</strong> app on your Android phone.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">
                  2
                </span>
                <span>Tap <strong>"Pair with TextPup Server"</strong> to open the camera scanner.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0 text-[10px]">
                  3
                </span>
                <span>Point your phone at this screen. No accounts, cables, or ADB required.</span>
              </div>
            </div>

            {/* Local Server Note */}
            <div className="flex items-center justify-between text-[11px] text-text-muted px-1">
              <span>Local Station URL: <code className="text-text-primary font-mono bg-surface px-1.5 py-0.5 rounded border border-border-subtle">{serverUrl}</code></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
