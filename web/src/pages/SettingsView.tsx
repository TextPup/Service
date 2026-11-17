import React, { useState, useEffect } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  Smartphone,
  Shield,
  Fingerprint,
  Sun,
  Moon,
  Check,
  Radio,
  History,
  DownloadCloud,
  RefreshCw,
  Bell,
  Volume2,
  QrCode,
  Unlink,
  Trash2,
  Plus,
  Battery,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { PairGatewayModal } from "../components/kit/PairGatewayModal";
import {
  getNotificationPermission,
  requestNotificationPermission,
  displayWebNotification,
  playNotificationSound,
} from "../utils/notifications";

export interface PairedDevice {
  id: string;
  name: string;
  isOnline: boolean;
  batteryPercent: number;
  lastPingAt: number;
  lastSeenAt: number;
  sims: Array<{
    slotIndex: number;
    simNumber: number;
    carrierName: string;
    phoneNumber?: string;
  }>;
}

interface SettingsViewProps {
  isHostOnline?: boolean;
  batteryPercent?: number;
  lastPingAt?: number;
  simLabels: Record<number, { label: string; color: string }>;
  onUpdateSimLabels: (newLabels: Record<number, { label: string; color: string }>) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isHostOnline = false,
  batteryPercent,
  lastPingAt,
  simLabels,
  onUpdateSimLabels,
}) => {
  const { theme, toggleTheme } = useTheme();

  // Gateway & Multi-Device Pairing state
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [isUnpairing, setIsUnpairing] = useState(false);
  const [unpairNotice, setUnpairNotice] = useState<string | null>(null);

  const fetchDevices = async () => {
    try {
      const res = await fetch("/api/gateway/devices");
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      console.error("Failed to fetch paired gateway devices", err);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [isHostOnline]);

  const handleUnpair = async (deviceId?: string) => {
    const confirmPrompt = deviceId
      ? "Are you sure you want to unpair this companion device? You can re-pair it anytime via QR code."
      : "Are you sure you want to unpair and disconnect the host device? This will clear all gateway tokens so you can scan a fresh QR code.";
    if (!window.confirm(confirmPrompt)) return;

    setIsUnpairing(true);
    setUnpairNotice(null);
    try {
      const endpoint = deviceId ? `/api/gateway/devices/${deviceId}/unpair` : "/api/gateway/unpair";
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unpair device");
      setUnpairNotice(data.message || "Companion device unpaired successfully");
      await fetchDevices();
    } catch (err: any) {
      alert(`Unpair error: ${err.message}`);
    } finally {
      setIsUnpairing(false);
    }
  };

  // Local state for SIM profiles
  const [sim1Label, setSim1Label] = useState(simLabels[1]?.label || "SIM 1");
  const [sim2Label, setSim2Label] = useState(simLabels[2]?.label || "SIM 2");
  const [simSaved, setSimSaved] = useState(false);

  // Security & Passkey state
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);

  // Web Notifications state
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(() =>
    getNotificationPermission()
  );
  const [testSent, setTestSent] = useState(false);

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(getNotificationPermission());
    if (granted) {
      await displayWebNotification({
        title: "TextPup Notifications Enabled! 🐶🔔",
        body: "Real-time desktop alerts are active for all incoming messages.",
      });
    }
  };

  const handleTestNotification = async () => {
    if (notifPermission !== "granted") {
      playNotificationSound();
      alert("Notification sound played! To see desktop popup banners, click 'Enable Notifications' first.");
      return;
    }
    setTestSent(true);
    await displayWebNotification({
      title: "TextPup Test Notification 🐶",
      body: "Incoming SMS desktop alerts and audio chimes are working perfectly!",
    });
    setTimeout(() => setTestSent(false), 2500);
  };

  // SMS History Import state
  const [isImportingHistory, setIsImportingHistory] = useState(false);
  const [historyResult, setHistoryResult] = useState<string | null>(null);

  const handleImportHistory = async () => {
    setIsImportingHistory(true);
    setHistoryResult(null);
    try {
      const res = await fetch("/api/threads/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setHistoryResult(data.message || "Wi-Fi sync command dispatched to host companion!");
    } catch (err: any) {
      alert(`Sync error: ${err.message}`);
    } finally {
      setIsImportingHistory(false);
    }
  };

  useEffect(() => {
    setSim1Label(simLabels[1]?.label || "SIM 1");
    setSim2Label(simLabels[2]?.label || "SIM 2");
  }, [simLabels]);

  const handleSaveSimLabels = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSimLabels({
      1: { label: sim1Label.trim() || "SIM 1", color: "#059669" },
      2: { label: sim2Label.trim() || "SIM 2", color: "#D97706" },
    });
    setSimSaved(true);
    setTimeout(() => setSimSaved(false), 2000);
  };

  const handleRegisterNewPasskey = async () => {
    setIsRegisteringPasskey(true);
    try {
      const optRes = await fetch("/api/auth/passkey/login-options", { method: "POST" });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error);

      await startRegistration({ optionsJSON: options });
      alert("Passkey successfully registered!");
    } catch (err: any) {
      alert(`Passkey error: ${err.message || "Operation canceled"}`);
    } finally {
      setIsRegisteringPasskey(false);
    }
  };


  const formatTimestamp = (ts?: number) => {
    if (!ts) return "Just now";
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full w-full bg-canvas overflow-y-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Settings</h2>
          <p className="text-xs text-text-secondary">
            Manage host phone connection, dual-SIM labels, security &amp; themes
          </p>
        </div>

        {/* 1. Host Phone Connectivity Status */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Host Android Phone Health</h3>
                <p className="text-xs text-text-muted">Cellular Radio Gateway &amp; Companion Pairing</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPairModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
                title="Pair Host Android Phone via QR"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Pair Host Phone</span>
              </button>

              <button
                type="button"
                onClick={() => handleUnpair()}
                disabled={isUnpairing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold cursor-pointer disabled:opacity-50 transition-colors"
                title="Disconnect & Unpair Gateway Companion"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>{isUnpairing ? "Unpairing..." : "Unpair Gateway"}</span>
              </button>
            </div>
          </div>

          {unpairNotice && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center justify-between">
              <span>{unpairNotice}</span>
              <button onClick={() => setUnpairNotice(null)} className="p-0.5 hover:opacity-75">
                <Check className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Status</span>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isHostOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                  }`}
                />
                <span className="text-sm font-semibold text-text-primary">
                  {isHostOnline ? "Connected" : "Offline"}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Battery Level</span>
              <p className="text-sm font-semibold text-text-primary mt-1">
                {batteryPercent !== undefined ? `${batteryPercent}%` : "Normal (Charging)"}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Last Heartbeat</span>
              <p className="text-sm font-semibold text-text-primary mt-1">
                {formatTimestamp(lastPingAt)}
              </p>
            </div>
          </div>

          {/* Paired Companion Devices List (Multi-Device Hub) */}
          <div className="pt-2 border-t border-border-subtle space-y-2">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Paired Cellular Devices ({devices.length})
            </h4>

            {devices.length > 0 ? (
              <div className="space-y-2.5">
                {devices.map((dev) => (
                  <div
                    key={dev.id}
                    className="p-3.5 rounded-xl bg-app border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            dev.isOnline ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                        />
                        <span className="text-sm font-bold text-text-primary">{dev.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sidebar text-text-muted border border-border-subtle">
                          {dev.id.substring(0, 10)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <Battery className="w-3.5 h-3.5" /> {dev.batteryPercent}%
                        </span>
                        <span>•</span>
                        <span>Last seen: {formatTimestamp(dev.lastSeenAt)}</span>
                      </div>

                      {dev.sims && dev.sims.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {dev.sims.map((s) => (
                            <span
                              key={s.slotIndex}
                              className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            >
                              SIM {s.simNumber}: {s.carrierName || "Active"} {s.phoneNumber ? `(${s.phoneNumber})` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUnpair(dev.id)}
                      disabled={isUnpairing}
                      className="self-start sm:self-center flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold cursor-pointer disabled:opacity-50"
                      title="Unpair this device"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Unpair</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-app border border-border-subtle text-center space-y-2">
                <p className="text-xs text-text-muted">
                  No companion phone connected. To link your phone and sync messages, scan the pairing QR code.
                </p>
                <button
                  type="button"
                  onClick={() => setIsPairModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Pair Host Companion</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 2. Dual-SIM Profiles & Labels */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Dual-SIM Profiles</h3>
              <p className="text-xs text-text-muted">Custom badges and capsule labels</p>
            </div>
          </div>

          <form onSubmit={handleSaveSimLabels} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-emerald-600 mb-1">
                SIM Slot 1 Label
              </label>
              <input
                type="text"
                value={sim1Label}
                onChange={(e) => setSim1Label(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-amber-600 mb-1">
                SIM Slot 2 Label
              </label>
              <input
                type="text"
                value={sim2Label}
                onChange={(e) => setSim2Label(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary"
              />
            </div>

            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer"
            >
              {simSaved ? <Check className="w-4 h-4" /> : null}
              <span>{simSaved ? "Saved!" : "Save SIM Labels"}</span>
            </button>
          </form>
        </section>

        {/* 3. Security & Passkeys */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Security &amp; Passkeys</h3>
              <p className="text-xs text-text-muted">Manage WebAuthn authenticators and encryption</p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-app border border-border-subtle">
            <div className="flex items-center gap-3">
              <Fingerprint className="w-5 h-5 text-accent-primary" />
              <div>
                <p className="text-xs font-bold text-text-primary">Add WebAuthn Passkey</p>
                <p className="text-[11px] text-text-muted">Hardware security key, Touch ID, or Windows Hello</p>
              </div>
            </div>
            <button
              onClick={handleRegisterNewPasskey}
              disabled={isRegisteringPasskey}
              className="px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isRegisteringPasskey ? "Registering..." : "Add Passkey"}
            </button>
          </div>
        </section>

        {/* 4. SMS History & Import */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Phone SMS History</h3>
              <p className="text-xs text-text-muted">Import messages from host phone telephony database</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-app border border-border-subtle space-y-3">
            <p className="text-xs text-text-secondary leading-relaxed">
              Import historical SMS messages stored on your Android device with dual-SIM carrier attribution, chronological ordering, and zero-knowledge encryption.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={handleImportHistory}
                disabled={isImportingHistory}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer transition-colors"
              >
                {isImportingHistory ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
                <span>{isImportingHistory ? "Importing from Phone..." : "Import SMS History"}</span>
              </button>
              {historyResult && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {historyResult}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* 5. Web Notifications & Audio Alerts */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Notifications &amp; Alerts</h3>
              <p className="text-xs text-text-muted">Desktop notifications and sound for incoming SMS</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-app border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    notifPermission === "granted"
                      ? "bg-emerald-500 animate-pulse"
                      : notifPermission === "denied"
                      ? "bg-rose-500"
                      : "bg-amber-500"
                  }`}
                />
                <span className="text-xs font-semibold text-text-primary">
                  {notifPermission === "granted"
                    ? "Desktop Notifications: Active & Allowed"
                    : notifPermission === "denied"
                    ? "Desktop Notifications: Blocked in Browser"
                    : "Desktop Notifications: Permission Needed"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {notifPermission !== "granted" ? (
                  <button
                    onClick={handleEnableNotifications}
                    className="px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
                  >
                    Enable Notifications
                  </button>
                ) : (
                  <button
                    onClick={handleTestNotification}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sidebar hover:bg-canvas border border-border-subtle text-xs font-semibold text-text-primary shadow-xs cursor-pointer transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-accent-primary" />
                    <span>{testSent ? "Alert Triggered!" : "Send Test Alert"}</span>
                  </button>
                )}
              </div>
            </div>

            {notifPermission === "denied" && (
              <p className="text-[11px] text-rose-500 dark:text-rose-400">
                Notifications are blocked in your browser settings. To enable, click the lock icon in the browser address bar and switch Notifications to Allow.
              </p>
            )}

            {notifPermission === "granted" && (
              <p className="text-[11px] text-text-muted">
                You will receive instant desktop alerts and audio chimes whenever an SMS arrives on SIM 1 or SIM 2, even when browsing other tabs.
              </p>
            )}
          </div>
        </section>

        {/* 6. Appearance & Theme */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-app text-text-primary">
                {theme === "dark" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5 text-amber-500" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Appearance Theme</h3>
                <p className="text-xs text-text-muted">Duxica Light &amp; Dark Theme Parity</p>
              </div>
            </div>

            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-app hover:bg-canvas border border-border-subtle text-xs font-semibold text-text-primary transition-colors cursor-pointer"
            >
              <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
            </button>
          </div>
        </section>
      </div>

      {/* QR Pairing Modal */}
      <PairGatewayModal
        isOpen={isPairModalOpen}
        onClose={() => {
          setIsPairModalOpen(false);
          fetchDevices();
        }}
        isHostOnline={isHostOnline}
      />
    </div>
  );
};
