import React, { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Lock, ShieldAlert } from "lucide-react";


interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 2FA Challenge State
  const [require2fa, setRequire2fa] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      if (data.require2fa) {
        setRequire2fa(true);
        setTempToken(data.tempToken);
      } else {
        onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handle2faSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempToken,
          totpCode: useRecoveryCode ? undefined : totpCode.trim(),
          recoveryCode: useRecoveryCode ? recoveryCode.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "2FA verification failed");
      }

      onLoginSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const optRes = await fetch("/api/auth/passkey/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error || "Failed to fetch passkey challenge");

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempToken: tempToken || "passkey_direct",
          passkeyResponse: assertion,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Passkey login failed");

      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || "Passkey verification canceled");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm rounded-2xl bg-sidebar border border-border-subtle shadow-card p-6 md:p-8">
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src="/icons/logo.png"
            alt="TextPup"
            className="w-20 h-20 object-contain drop-shadow mb-2"
          />
          <h1 className="text-xl font-bold text-text-primary">Welcome to TextPup</h1>
          <p className="text-xs text-text-secondary mt-1">
            Secure self-hosted dual-SIM messenger
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Master Password Login */}
        {!require2fa ? (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Master Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 mt-2 cursor-pointer"
            >
              {loading ? "Authenticating..." : "Sign In with Password"}
            </button>

            {/* Passkey 1-Tap Trigger */}
            <div className="pt-3 border-t border-border-subtle text-center">
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-app hover:bg-canvas border border-border-subtle text-text-primary text-xs font-semibold transition-colors cursor-pointer"
              >
                <Fingerprint className="w-4 h-4 text-accent-primary" />
                <span>Sign in with Passkey</span>
              </button>
            </div>
          </form>
        ) : (
          /* Step 2: 2FA Challenge Form */
          <form onSubmit={handle2faSubmit} className="space-y-4">
            <div className="text-center mb-2">
              <div className="inline-flex p-2.5 rounded-full bg-accent-soft text-accent-primary mb-2">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-text-primary">Two-Factor Authentication</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                {useRecoveryCode
                  ? "Enter one of your 8 emergency backup codes"
                  : "Enter the 6-digit code from your authenticator app"}
              </p>
            </div>

            {!useRecoveryCode ? (
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full px-3 py-2.5 text-center text-lg font-mono tracking-widest rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                autoFocus
                required
              />
            ) : (
              <input
                type="text"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="e.g. a1b2-c3d4"
                className="w-full px-3 py-2 text-center text-sm font-mono rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                autoFocus
                required
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Verifying..." : "Verify & Unlock"}
            </button>

            <div className="flex items-center justify-between text-[11px] text-text-secondary pt-2">
              <button
                type="button"
                onClick={() => setUseRecoveryCode((prev) => !prev)}
                className="hover:underline text-accent-primary font-medium cursor-pointer"
              >
                {useRecoveryCode ? "Use Authenticator App" : "Use Emergency Backup Code"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setRequire2fa(false);
                  setTempToken(null);
                }}
                className="hover:underline text-text-muted cursor-pointer"
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
