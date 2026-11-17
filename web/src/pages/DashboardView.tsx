import React, { useState, useEffect } from "react";
import {
  MessageSquare,
  Users,
  Smartphone,
  HardDrive,
  ShieldCheck,
  Radio,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Plus,
  History,
  Check,
  QrCode,
} from "lucide-react";
import { type NavTab } from "../components/kit/SidebarRail";
import { PairGatewayModal } from "../components/kit/PairGatewayModal";

interface StatsData {
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  sim1Messages: number;
  sim2Messages: number;
  totalThreads: number;
  unreadThreads: number;
  totalContacts: number;
  totalAttachments: number;
  mediaStorageBytes: number;
  isVaultUnlocked: boolean;
  gatewayUrl: string | null;
  simProfiles: Record<string, any> | null;
  recentMessages: Array<{
    id: string;
    phone: string;
    contactName: string | null;
    direction: "inbound" | "outbound";
    simNumber: number;
    body: string | null;
    createdAt: number;
  }>;
}

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
  isHostOnline?: boolean;
  batteryPercent?: number;
  lastPingAt?: number;
  simLabels: Record<number, { label: string; color: string }>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  isHostOnline = true,
  batteryPercent,
  lastPingAt,
  simLabels,
}) => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load dashboard stats", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncHistory = async () => {
    setIsSyncing(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/threads/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setActionMsg(data.message || "Wi-Fi sync command dispatched to host phone!");
      fetchStats();
      setTimeout(() => setActionMsg(null), 5000);
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatRelativeTime = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const sim1Count = stats?.sim1Messages || 0;
  const sim2Count = stats?.sim2Messages || 0;
  const totalSim = sim1Count + sim2Count || 1;
  const sim1Pct = Math.round((sim1Count / totalSim) * 100);
  const sim2Pct = 100 - sim1Pct;

  return (
    <div className="flex flex-col h-full w-full bg-canvas overflow-y-auto p-4 md:p-8">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/icons/logo.png"
              alt="TextPup"
              className="w-12 h-12 object-contain drop-shadow"
            />
            <div>
              <h1 className="text-2xl font-bold text-text-primary">TextPup Dashboard</h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Live dual-SIM telemetry, conversation statistics &amp; system health
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPairModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sidebar hover:bg-canvas border border-border-subtle text-xs font-semibold text-text-primary shadow-xs cursor-pointer transition-colors"
              title="Pair Host Android Phone via QR"
            >
              <QrCode className="w-3.5 h-3.5 text-primary" />
              <span>Pair Host Phone</span>
            </button>

            <button
              onClick={handleSyncHistory}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sidebar hover:bg-canvas border border-border-subtle text-xs font-semibold text-text-primary shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
              title="Sync Phone SMS History"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-accent-primary ${isSyncing ? "animate-spin" : ""}`} />
              <span>{isSyncing ? "Syncing..." : "Sync SMS"}</span>
            </button>

            <button
              onClick={() => onNavigate("messages")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Action status notification */}
        {actionMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center justify-between">
            <span>{actionMsg}</span>
            <button onClick={() => setActionMsg(null)} className="p-0.5 hover:opacity-75">
              <Check className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. Core Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Total Messages Card */}
          <div className="p-4 rounded-2xl bg-sidebar border border-border-subtle shadow-card flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-text-muted uppercase">Total Messages</span>
              <div className="p-2 rounded-xl bg-accent-soft text-accent-primary">
                <MessageSquare className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-extrabold text-text-primary">
                {stats?.totalMessages.toLocaleString() || 0}
              </span>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
                <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <ArrowDownLeft className="w-3 h-3" /> {stats?.inboundMessages || 0} in
                </span>
                <span className="flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400 font-semibold">
                  <ArrowUpRight className="w-3 h-3" /> {stats?.outboundMessages || 0} out
                </span>
              </div>
            </div>
          </div>

          {/* Active Conversations Card */}
          <div
            onClick={() => onNavigate("messages")}
            className="p-4 rounded-2xl bg-sidebar border border-border-subtle shadow-card flex flex-col justify-between cursor-pointer hover:border-accent-primary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-text-muted uppercase">Conversations</span>
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600">
                <History className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-extrabold text-text-primary">
                {stats?.totalThreads || 0}
              </span>
              <p className="text-[11px] text-text-muted mt-1.5">
                {stats?.unreadThreads ? (
                  <span className="text-accent-primary font-bold">{stats.unreadThreads} unread</span>
                ) : (
                  "All caught up"
                )}
              </p>
            </div>
          </div>

          {/* Encrypted Contacts Card */}
          <div
            onClick={() => onNavigate("contacts")}
            className="p-4 rounded-2xl bg-sidebar border border-border-subtle shadow-card flex flex-col justify-between cursor-pointer hover:border-accent-primary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-text-muted uppercase">Encrypted Contacts</span>
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-extrabold text-text-primary">
                {stats?.totalContacts || 0}
              </span>
              <p className="text-[11px] text-text-muted mt-1.5">Universal across SIMs</p>
            </div>
          </div>

          {/* MMS Storage Card */}
          <div className="p-4 rounded-2xl bg-sidebar border border-border-subtle shadow-card flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-text-muted uppercase">MMS Storage</span>
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600">
                <HardDrive className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-extrabold text-text-primary">
                {formatBytes(stats?.mediaStorageBytes || 0)}
              </span>
              <p className="text-[11px] text-text-muted mt-1.5">
                {stats?.totalAttachments || 0} encrypted media file{stats?.totalAttachments !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {/* 2. Dual-SIM Telemetry & Distribution */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Dual-SIM Traffic Breakdown</h3>
                <p className="text-xs text-text-muted">Message volume by SIM slot</p>
              </div>
            </div>
          </div>

          {/* Progress Bar Visualizer */}
          <div className="space-y-2">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-app">
              <div
                style={{ width: `${sim1Pct}%` }}
                className="bg-emerald-500 transition-all duration-500"
                title={`${simLabels[1]?.label || "SIM 1"}: ${sim1Pct}%`}
              />
              <div
                style={{ width: `${sim2Pct}%` }}
                className="bg-amber-500 transition-all duration-500"
                title={`${simLabels[2]?.label || "SIM 2"}: ${sim2Pct}%`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {/* SIM 1 Box */}
              <div className="p-3.5 rounded-xl bg-app border border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-text-primary">
                      {simLabels[1]?.label || "SIM 1"}
                    </h4>
                    <p className="text-[11px] text-text-muted font-mono">
                      {stats?.simProfiles?.[1]?.phoneNumber
                        ? `${stats.simProfiles[1].phoneNumber} • ${stats.simProfiles[1].carrier || "Slot 1"}`
                        : "Slot 1 Cellular Radio"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-text-primary">{sim1Count.toLocaleString()}</span>
                  <span className="text-[10px] text-text-muted block">{sim1Pct}%</span>
                </div>
              </div>

              {/* SIM 2 Box */}
              <div className="p-3.5 rounded-xl bg-app border border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-text-primary">
                      {simLabels[2]?.label || "SIM 2"}
                    </h4>
                    <p className="text-[11px] text-text-muted font-mono">
                      {stats?.simProfiles?.[2]?.phoneNumber
                        ? `${stats.simProfiles[2].phoneNumber} • ${stats.simProfiles[2].carrier || "Slot 2"}`
                        : "Slot 2 Cellular Radio"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-text-primary">{sim2Count.toLocaleString()}</span>
                  <span className="text-[10px] text-text-muted block">{sim2Pct}%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Host Connection & System Health */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-soft text-accent-primary">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">System Health &amp; Gateway Status</h3>
              <p className="text-xs text-text-muted">Android Host &amp; Crypto Vault state</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Host Connection</span>
              <div className="flex items-center gap-2 mt-1.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isHostOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                  }`}
                />
                <span className="text-xs font-bold text-text-primary">
                  {isHostOnline ? "Online & Synced" : "Host Disconnected"}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 font-mono">
                {stats?.gatewayUrl || (isHostOnline ? "WebSocket Companion Active" : "Awaiting Host Pairing")}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Battery &amp; Power</span>
              <p className="text-xs font-bold text-text-primary mt-1.5">
                {batteryPercent !== undefined ? `${batteryPercent}%` : "Normal (Charging)"}
              </p>
              <p className="text-[10px] text-text-muted mt-1">
                Last ping: {lastPingAt ? formatRelativeTime(lastPingAt) : "Recently"}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-app border border-border-subtle">
              <span className="text-[10px] font-bold text-text-muted uppercase">Zero-Knowledge Vault</span>
              <div className="flex items-center gap-2 mt-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  AES-256-GCM Unlocked
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1">Keys resident in RAM only</p>
            </div>
          </div>
        </section>

        {/* 4. Recent Real-Time Message Activity */}
        <section className="p-5 rounded-2xl bg-sidebar border border-border-subtle shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-primary">Recent Message Activity</h3>
            <button
              onClick={() => onNavigate("messages")}
              className="text-xs font-semibold text-accent-primary hover:underline cursor-pointer"
            >
              View All &rarr;
            </button>
          </div>

          {stats?.recentMessages && stats.recentMessages.length > 0 ? (
            <div className="divide-y divide-border-subtle">
              {stats.recentMessages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => onNavigate("messages")}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-app/50 -mx-2 px-2 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
                        msg.direction === "inbound" ? "bg-emerald-500" : "bg-indigo-500"
                      }`}
                    >
                      {msg.direction === "inbound" ? "↓" : "↑"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-primary truncate">
                          {msg.contactName || msg.phone}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                            msg.simNumber === 2
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-emerald-500/10 text-emerald-600"
                          }`}
                        >
                          SIM {msg.simNumber}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">
                        {msg.body || "[Attachment]"}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] text-text-muted shrink-0 font-medium">
                    {formatRelativeTime(msg.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-text-muted">
              {loading ? "Loading telemetry..." : "No recent messages"}
            </div>
          )}
        </section>
      </div>

      {/* Zero-Trust QR Pairing Modal */}
      <PairGatewayModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        isHostOnline={isHostOnline}
      />
    </div>
  );
};
