import React, { useState } from "react";
import { Lock, KeyRound, AlertCircle, Unlock } from "lucide-react";

interface VaultUnlockModalProps {
  isOpen: boolean;
  onUnlocked: () => void;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({ isOpen, onUnlocked }) => {
  const [useRecovery, setUseRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = useRecovery
        ? { recoveryKey: recoveryKey.trim() }
        : { password };

      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to unlock vault");
      }

      onUnlocked();
    } catch (err: any) {
      setError(err.message || "Invalid password or recovery key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border-subtle shadow-2xl p-6">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="relative mb-3">
            <img
              src="/icons/logo.png"
              alt="TextPup"
              className="w-16 h-16 object-contain drop-shadow"
            />
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-amber-500 text-white shadow-sm">
              <Lock className="w-3.5 h-3.5" />
            </div>
          </div>
          <h2 className="text-lg font-bold text-text-primary">Crypto Vault is Locked</h2>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          {!useRecovery ? (
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Master Vault Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                autoFocus
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Emergency 32-Char Recovery Key
              </label>
              <input
                type="text"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                placeholder="e.g. 1a2b-3c4d-5e6f-..."
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary font-mono text-xs focus:outline-accent-primary"
                autoFocus
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (!password && !recoveryKey)}
            className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold shadow-md transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            <Unlock className="w-4 h-4" />
            <span>{loading ? "Unlocking Vault..." : "Unlock Vault"}</span>
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-border-subtle text-center">
          <button
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setError(null);
            }}
            className="text-xs text-text-muted hover:text-accent-primary transition-colors cursor-pointer flex items-center justify-center gap-1.5 mx-auto"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{useRecovery ? "Use Master Password instead" : "Use Emergency Recovery Key"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
