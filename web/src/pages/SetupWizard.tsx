import React, { useState, useEffect, useRef } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import QRCode from "qrcode";
import {
  Copy,
  Check,
  ArrowRight,
  QrCode,
  Fingerprint,
  Smartphone,
  CheckCircle2,
  RefreshCw,
  Radio,
} from "lucide-react";


interface SetupWizardProps {
  onComplete: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const [setupToken, setSetupToken] = useState<string>(
    () => sessionStorage.getItem("textpup_setup_token") || ""
  );
  const [currentStep, setCurrentStep] = useState<number>(() => {
    const saved = Number(sessionStorage.getItem("textpup_setup_step"));
    return saved >= 1 && saved <= 3 ? saved : 1;
  });
  const [maxAvailableStep, setMaxAvailableStep] = useState<number>(1);
  const [hasAdmin, setHasAdmin] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Resume step and progress from server onboarding status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/setup/status");
      const data = await res.json();
      if (!data.initialized) {
        if (data.username) setUsername(data.username);
        setHasAdmin(Boolean(data.hasAdmin));
        if (data.has2Fa) setTwoFaEnrolled(true);
        if (data.setupToken) {
          setSetupToken(data.setupToken);
          sessionStorage.setItem("textpup_setup_token", data.setupToken);
        }

        const available = Number(data.step) || 1;
        setMaxAvailableStep(available);

        const savedStep = Number(sessionStorage.getItem("textpup_setup_step"));
        if (savedStep && savedStep >= 1 && savedStep <= available) {
          setCurrentStep(savedStep);
        } else {
          setCurrentStep(available);
          sessionStorage.setItem("textpup_setup_step", available.toString());
        }
      }
    } catch (err) {
      console.error("Failed to fetch setup status", err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const changeStep = (step: number) => {
    setCurrentStep(step);
    sessionStorage.setItem("textpup_setup_step", step.toString());
  };

  // Step 1 Form
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Step 2 2FA
  const [totpData, setTotpData] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [twoFaEnrolled, setTwoFaEnrolled] = useState(false);

  // Step 3 TextPup Companion App (Host QR Code Pairing)
  const [hostQrPayload, setHostQrPayload] = useState<string>("");
  const [hostServerUrl, setHostServerUrl] = useState<string>("");
  const [hostExpiresAt, setHostExpiresAt] = useState<number>(0);
  const [hostTimeLeft, setHostTimeLeft] = useState<number>(600);
  const [hostStatus, setHostStatus] = useState<{
    isOnline: boolean;
    batteryPercent: number;
    sims: Array<{ slotIndex: number; simNumber: number; carrierName: string; phoneNumber?: string }>;
  }>({ isOnline: false, batteryPercent: 100, sims: [] });
  const [loadingQr, setLoadingQr] = useState(false);
  const [editingServerUrl, setEditingServerUrl] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState("");
  const [sim1Label, setSim1Label] = useState("SIM 1 (Primary)");
  const [sim2Label, setSim2Label] = useState("SIM 2 (Secondary)");
  const hostCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  // Step 1: Submit Admin and Initialize Vault
  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup/step1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize vault");
      }

      setRecoveryKey(data.recoveryKey);
      setRecoveryCodes(data.recoveryCodes);
      setHasAdmin(true);
      setMaxAvailableStep((prev) => Math.max(prev, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Reset all setup progress to restart from Step 1
  const handleResetSetup = async () => {
    if (!setupToken) {
      setError("Please provide your bootstrap setup token to reset setup progress.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/reset", {
        method: "POST",
        headers: {
          "X-Setup-Token": setupToken.trim(),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");

      setPassword("");
      setConfirmPassword("");
      setRecoveryKey(null);
      setRecoveryCodes([]);
      setTwoFaEnrolled(false);
      setTotpData(null);
      setTotpCode("");
      setHasAdmin(false);
      setMaxAvailableStep(1);
      changeStep(1);
      setShowResetConfirm(false);
      sessionStorage.removeItem("textpup_setup_step");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Generate TOTP
  const handleGenerateTotp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/setup/step2/totp/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate TOTP secret");
      setTotpData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify TOTP Code
  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpData || !totpCode) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/setup/step2/totp/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
        body: JSON.stringify({ secret: totpData.secret, code: totpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify TOTP code");
      setTwoFaEnrolled(true);
      setMaxAvailableStep((prev) => Math.max(prev, 3));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Register WebAuthn Passkey
  const handleRegisterPasskey = async () => {
    setError(null);
    setLoading(true);
    try {
      const optRes = await fetch("/api/setup/step2/passkey/register-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error || "Failed to fetch passkey options");

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/setup/step2/passkey/register-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
        body: JSON.stringify({ response: attestation, deviceLabel: "Admin Passkey" }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Failed to enroll passkey");

      setTwoFaEnrolled(true);
      setMaxAvailableStep((prev) => Math.max(prev, 3));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Fetch Companion App Pairing QR code
  const fetchPairingQr = async (overrideUrl?: string) => {
    setLoadingQr(true);
    try {
      const url = overrideUrl
        ? `/api/setup/pair-qr?serverUrl=${encodeURIComponent(overrideUrl)}`
        : "/api/setup/pair-qr";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setHostServerUrl(data.serverUrl);
        setCustomServerUrl(data.serverUrl);
        setHostQrPayload(data.qrPayload);
        setHostExpiresAt(data.expiresAt);
        const rem = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000));
        setHostTimeLeft(rem);
      }
    } catch (err) {
      console.error("Failed to load companion pairing QR code", err);
    } finally {
      setLoadingQr(false);
    }
  };

  // Render QR Canvas whenever payload changes or step becomes 3
  useEffect(() => {
    if (currentStep === 3 && hostCanvasRef.current && hostQrPayload) {
      QRCode.toCanvas(
        hostCanvasRef.current,
        hostQrPayload,
        {
          width: 220,
          margin: 2,
          color: {
            dark: "#0F172A",
            light: "#FFFFFF",
          },
        },
        (err) => {
          if (err) console.error("QR render error:", err);
        }
      );
    }
  }, [currentStep, hostQrPayload]);

  // QR Expiry Countdown Timer
  useEffect(() => {
    if (currentStep !== 3 || hostExpiresAt === 0) return;
    const interval = setInterval(() => {
      const rem = Math.max(0, Math.floor((hostExpiresAt - Date.now()) / 1000));
      setHostTimeLeft(rem);
      if (rem <= 0) {
        clearInterval(interval);
        fetchPairingQr(hostServerUrl || undefined);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep, hostExpiresAt, hostServerUrl]);

  // Poll Host Telemetry during Step 3
  useEffect(() => {
    if (currentStep !== 3) return;

    fetchPairingQr();

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/setup/gateway/status");
        if (res.ok) {
          const status = await res.json();
          setHostStatus(status);
          if (status.sims && status.sims.length > 0) {
            if (status.sims[0]?.carrierName) {
              setSim1Label(`${status.sims[0].carrierName} (Primary)`);
            }
            if (status.sims[1]?.carrierName) {
              setSim2Label(`${status.sims[1].carrierName} (Secondary)`);
            }
          }
        }
      } catch (err) {
        // Ignore polling errors
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [currentStep]);

  // Step 3: Pair & Finalize Setup
  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        gatewayType: "textpup_host",
        simProfiles: {
          1: { label: sim1Label.trim() || "SIM 1", color: "#059669" },
          2: { label: sim2Label.trim() || "SIM 2", color: "#D97706" },
        },
      };

      const res = await fetch("/api/setup/step3/pair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken.trim(),
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `Request failed with status ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || "Gateway pairing failed");

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 bg-app">
      <div className="w-full max-w-xl rounded-2xl bg-sidebar border border-border-subtle shadow-card p-6 md:p-8">
        {/* Header Mascot Branding & Reset Action */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <img
              src="/icons/logo.png"
              alt="TextPup Logo"
              className="w-14 h-14 object-contain drop-shadow"
            />
            <div>
              <h1 className="text-xl font-bold text-text-primary">TextPup First-Run Setup</h1>
              <p className="text-xs text-text-secondary">
                Initialize encrypted vault, mandatory 2FA &amp; dual-SIM bridge
              </p>
            </div>
          </div>
          {(hasAdmin || currentStep > 1) && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="px-2.5 py-1 text-xs rounded-lg border border-border-subtle text-text-muted hover:text-rose-400 hover:border-rose-400/40 transition-colors cursor-pointer shrink-0"
              title="Reset all setup progress and start over from Step 1"
            >
              Start Over
            </button>
          )}
        </div>

        {/* Reset Confirmation Dialog */}
        {showResetConfirm && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs">
            <p className="font-bold text-rose-400 mb-1">Wipe Setup Progress &amp; Start Over?</p>
            <p className="text-text-secondary mb-3">
              This will clear the admin account, vault keys, and 2FA settings from this setup attempt, allowing you to configure everything again from Step 1.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetSetup}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
              >
                {loading ? "Resetting..." : "Yes, Wipe & Restart"}
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:text-text-primary cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Setup Token Bootstrap Prompt */}
        {!setupToken && (
          <div className="mb-6 p-4 rounded-xl bg-accent-soft border border-accent-primary/20">
            <label className="block text-xs font-bold text-accent-primary uppercase tracking-wider mb-1">
              Bootstrap Setup Token (X-Setup-Token)
            </label>
            <p className="text-xs text-text-secondary mb-3">
              Enter the setup token from your server terminal or <code>APP_SETUP_TOKEN</code> environment variable.
            </p>
            <input
              type="text"
              value={setupToken}
              onChange={(e) => {
                const val = e.target.value.trim();
                setSetupToken(val);
                sessionStorage.setItem("textpup_setup_token", val);
              }}
              placeholder="e.g. fe3a0391a2aeff..."
              className="w-full px-3 py-2 text-sm rounded-lg bg-canvas border border-border-subtle font-mono text-text-primary focus:outline-accent-primary"
              required
            />
          </div>
        )}

        {/* Step Indicator with Click-to-Navigate for Completed Steps */}
        <div className="flex items-center justify-between mb-8 px-2">
          {[
            { step: 1, label: "Vault & Admin" },
            { step: 2, label: "2FA Security" },
            { step: 3, label: "Host Pairing" },
          ].map((item) => {
            const isClickable = item.step <= maxAvailableStep;
            return (
              <button
                key={item.step}
                type="button"
                disabled={!isClickable}
                onClick={() => changeStep(item.step)}
                className={`flex flex-col items-center group transition-opacity ${
                  isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all ${
                    currentStep === item.step
                      ? "bg-accent-primary text-white ring-4 ring-accent-soft scale-105"
                      : maxAvailableStep > item.step
                      ? "bg-emerald-500 text-white group-hover:ring-2 group-hover:ring-emerald-400"
                      : "bg-border-subtle text-text-muted"
                  }`}
                >
                  {maxAvailableStep > item.step ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    item.step
                  )}
                </div>
                <span
                  className={`text-[11px] mt-1.5 font-medium ${
                    currentStep === item.step
                      ? "text-accent-primary font-bold"
                      : maxAvailableStep > item.step
                      ? "text-emerald-500"
                      : "text-text-muted"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-medium">
            {error}
          </div>
        )}

        {/* STEP 1: Vault & Admin Account */}
        {currentStep === 1 && !recoveryKey && (
          <form onSubmit={handleStep1} className="space-y-4">
            {hasAdmin && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between">
                <span>✓ Vault &amp; admin account "{username}" are initialized.</span>
                <button
                  type="button"
                  onClick={() => changeStep(2)}
                  className="font-bold underline hover:text-emerald-300 cursor-pointer"
                >
                  Proceed to Step 2 →
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Admin Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Master Password (Derives Argon2id KEK)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Confirm Master Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !setupToken}
              className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 mt-4 cursor-pointer"
            >
              {loading ? "Initializing Vault..." : "Create Admin & Initialize Vault"}
            </button>
          </form>
        )}

        {/* STEP 1.5: Recovery Key & Backup Codes Display */}
        {currentStep === 1 && recoveryKey && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
              <p className="font-bold mb-1">⚠️ Save your recovery key &amp; backup codes!</p>
              <p>
                These will only be shown once. If you forget your master password, your recovery key is the ONLY way to recover your encrypted messages.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-canvas border border-border-subtle">
              <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">
                Master Recovery Key
              </label>
              <p className="font-mono text-sm font-bold text-text-primary select-all">
                {recoveryKey}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-canvas border border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-text-muted uppercase">
                  8 Single-Use Recovery Backup Codes
                </label>
                <button
                  type="button"
                  onClick={() => copyToClipboard(recoveryCodes.join("\n"))}
                  className="flex items-center gap-1 text-xs font-semibold text-accent-primary hover:underline"
                >
                  {copiedCodes ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCodes ? "Copied" : "Copy All"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-xs text-text-primary">
                {recoveryCodes.map((code, idx) => (
                  <span key={idx} className="p-1.5 bg-app rounded-md select-all">
                    {code}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => changeStep(2)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors cursor-pointer"
            >
              <span>I have securely saved these codes</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 2: Mandatory 2FA */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <p className="text-xs text-text-secondary">
              TextPup requires at least one 2FA factor (Authenticator App or WebAuthn Passkey) before setup can be completed.
            </p>

            {/* Option A: Passkey */}
            <div className="p-4 rounded-xl bg-canvas border border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-accent-soft text-accent-primary">
                  <Fingerprint className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary">WebAuthn Passkey</h4>
                  <p className="text-xs text-text-muted">Touch ID, Face ID, or Windows Hello</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRegisterPasskey}
                disabled={loading}
                className="px-3.5 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                Register Passkey
              </button>
            </div>

            <div className="flex items-center gap-2 my-2">
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-[11px] font-bold text-text-muted uppercase">OR</span>
              <div className="flex-1 h-px bg-border-subtle" />
            </div>

            {/* Option B: TOTP Authenticator */}
            {!totpData ? (
              <button
                type="button"
                onClick={handleGenerateTotp}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-canvas border border-border-subtle hover:bg-app text-text-primary text-sm font-semibold transition-colors cursor-pointer"
              >
                <QrCode className="w-5 h-5 text-accent-primary" />
                <span>Configure Authenticator App (Google Authenticator / 1Password)</span>
              </button>
            ) : (
              <form onSubmit={handleVerifyTotp} className="p-4 rounded-xl bg-canvas border border-border-subtle space-y-3">
                <h4 className="text-xs font-bold text-text-primary">Scan QR Code or Enter Secret Key</h4>
                <div className="p-2 rounded-lg bg-app font-mono text-xs text-accent-primary break-all select-all">
                  {totpData.secret}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    className="flex-1 px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary text-center font-mono tracking-widest"
                    required
                  />
                  <button
                    type="submit"
                    disabled={loading || totpCode.length < 6}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Verify Code
                  </button>
                </div>
              </form>
            )}

            {twoFaEnrolled && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>2FA successfully verified and enrolled!</span>
              </div>
            )}

            <button
              type="button"
              disabled={!twoFaEnrolled}
              onClick={() => changeStep(3)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span>Continue to Radio &amp; Gateway Pairing</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 3: Companion App Pairing (QR Code) & Dual-SIM Calibration */}
        {currentStep === 3 && (
          <form onSubmit={handleStep3} className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
              <div>
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-accent-primary" />
                  Pair Cellular Radios
                </h2>
                <p className="text-xs text-text-secondary">
                  Connect your Android phone to send &amp; receive SMS/MMS directly through TextPup
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* QR Code Presentation Card */}
              <div className="p-5 rounded-2xl bg-canvas border border-border-subtle flex flex-col items-center text-center shadow-inner">
                <div className="mb-3">
                  <span className="text-xs font-bold text-text-primary uppercase tracking-wider block">
                    TextPup Host Companion App
                  </span>
                  <span className="text-[11px] text-text-secondary">
                    Open TextPup Host on your phone, complete permissions, and scan this QR code:
                  </span>
                </div>

                {/* QR Canvas */}
                <div className="relative p-3 bg-white rounded-2xl shadow-md border border-slate-200">
                  {loadingQr ? (
                    <div className="w-[220px] h-[220px] flex items-center justify-center text-slate-400">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                  ) : (
                    <canvas ref={hostCanvasRef} className="block rounded-lg" />
                  )}
                </div>

                {/* Live Connection Telemetry Badge */}
                <div className="mt-4 w-full">
                  {hostStatus.isOnline ? (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Phone Connected! Cellular Radios Active ({hostStatus.batteryPercent}% Battery)</span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-accent-soft border border-accent-primary/20 text-accent-primary text-xs flex items-center justify-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-primary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-primary"></span>
                      </span>
                      <span>
                        Waiting for scan... (Expires in {Math.floor(hostTimeLeft / 60)}:{(hostTimeLeft % 60).toString().padStart(2, "0")})
                      </span>
                      <button
                        type="button"
                        onClick={() => fetchPairingQr(hostServerUrl)}
                        className="ml-1 text-[11px] underline hover:text-accent-hover cursor-pointer"
                      >
                        Refresh
                      </button>
                    </div>
                  )}

                  {/* Detected SIM cards list */}
                  {hostStatus.sims && hostStatus.sims.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap justify-center gap-2">
                      {hostStatus.sims.map((s, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-sidebar border border-border-subtle text-[11px] font-mono text-text-primary flex items-center gap-1.5"
                        >
                          <Radio className="w-3 h-3 text-emerald-500" />
                          SIM {s.simNumber}: {s.carrierName} {s.phoneNumber ? `(${s.phoneNumber})` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Server URL display / customize toggle */}
                <div className="mt-3 text-[11px] text-text-secondary w-full">
                  {!editingServerUrl ? (
                    <div className="flex items-center justify-center gap-2">
                      <span>Server URL: <code className="text-text-primary font-mono">{hostServerUrl || "Detecting..."}</code></span>
                      <button
                        type="button"
                        onClick={() => setEditingServerUrl(true)}
                        className="text-accent-primary hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 max-w-sm mx-auto mt-1">
                      <input
                        type="text"
                        value={customServerUrl}
                        onChange={(e) => setCustomServerUrl(e.target.value)}
                        className="flex-1 px-2.5 py-1 text-xs rounded-lg bg-sidebar border border-border-subtle text-text-primary font-mono"
                        placeholder="http://192.168.x.x:8080"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingServerUrl(false);
                          fetchPairingQr(customServerUrl);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-accent-primary text-white text-xs font-semibold cursor-pointer"
                      >
                        Update
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Dual-SIM Profile Calibration */}
              <div className="pt-2 border-t border-border-subtle">
                <label className="block text-xs font-bold text-text-primary mb-2">
                  Dual-SIM Profile Calibration
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] font-semibold text-emerald-500 block mb-0.5">SIM Slot 1 Label</span>
                    <input
                      type="text"
                      value={sim1Label}
                      onChange={(e) => setSim1Label(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-app border border-border-subtle text-text-primary"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-amber-500 block mb-0.5">SIM Slot 2 Label</span>
                    <input
                      type="text"
                      value={sim2Label}
                      onChange={(e) => setSim2Label(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-app border border-border-subtle text-text-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 mt-4 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{loading ? "Pairing & Finalizing Setup..." : "Complete Setup & Launch TextPup"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
