import { useState, useEffect } from "react";
import { AppShell } from "./components/kit/AppShell";
import { type NavTab } from "./components/kit/SidebarRail";
import { VaultUnlockModal } from "./components/kit/VaultUnlockModal";
import { SetupWizard } from "./pages/SetupWizard";
import { LoginPage } from "./pages/LoginPage";
import { DashboardView } from "./pages/DashboardView";
import { MessengerView } from "./pages/MessengerView";
import { ContactsView } from "./pages/ContactsView";
import { SettingsView } from "./pages/SettingsView";
import { useEvents } from "./hooks/useEvents";
import { subscribeToPushNotifications } from "./utils/push";
import {
  getNotificationPermission,
  requestNotificationPermission,
  displayWebNotification,
} from "./utils/notifications";
import { Bell, X } from "lucide-react";

export default function App() {
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>("messages");
  const [totalUnread, setTotalUnread] = useState(0);

  // Notification permission banner state
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(() =>
    getNotificationPermission()
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Live device status from SSE
  const [isHostOnline, setIsHostOnline] = useState(false);
  const [batteryPercent, setBatteryPercent] = useState<number | undefined>(undefined);
  const [lastPingAt, setLastPingAt] = useState<number | undefined>(Date.now());

  // SSE Real-time Listener for host phone connection, incoming messages & vault state
  useEvents({
    enabled: Boolean(isAuthenticated),
    onVaultStatus: (status) => {
      setIsVaultUnlocked(Boolean(status.isVaultUnlocked));
    },
    onDeviceStatus: (status) => {
      setIsHostOnline(status.isOnline);
      if (status.batteryPercent !== undefined) {
        setBatteryPercent(status.batteryPercent);
      }
      setLastPingAt(status.lastPingAt);
    },
    onMessageNew: (ev) => {
      if (ev.direction === "inbound") {
        // Suppress notifications for backfilled / historical messages
        if (ev.createdAt && Date.now() - ev.createdAt > 120_000) {
          return;
        }

        // Suppress notifications when the user is actively viewing the messages tab with browser focus
        const isMessagesViewActive =
          activeTab === "messages" &&
          document.visibilityState === "visible" &&
          document.hasFocus();

        if (isMessagesViewActive) {
          return;
        }

        displayWebNotification({
          title: `SMS from ${ev.phone} (SIM ${ev.simNumber})`,
          body: ev.body || (ev.hasAttachment ? "[Attachment]" : "New message"),
          tag: `thread-${ev.threadId}`,
          onClick: () => {
            setActiveTab("messages");
          },
        });
      }
    },
  });


  // SIM Profile labels
  const [simLabels, setSimLabels] = useState<Record<number, { label: string; color: string }>>(() => {
    const saved = localStorage.getItem("textpup_sim_labels");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      1: { label: "SIM 1", color: "#059669" },
      2: { label: "SIM 2", color: "#D97706" },
    };
  });

  const updateSimLabels = (newLabels: Record<number, { label: string; color: string }>) => {
    setSimLabels(newLabels);
    localStorage.setItem("textpup_sim_labels", JSON.stringify(newLabels));
  };

  // Check setup and authentication status
  const checkStatus = async () => {
    try {
      const setupRes = await fetch("/api/setup/status");
      const setupData = await setupRes.json();

      if (!setupData.initialized) {
        setIsInitialized(false);
        setIsAuthenticated(false);
        return;
      }

      setIsInitialized(true);

      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        setIsAuthenticated(true);
        setIsVaultUnlocked(Boolean(meData.isVaultUnlocked));
        subscribeToPushNotifications().catch(() => {});
      } else {
        setIsAuthenticated(false);
      }

    } catch {
      setIsInitialized(true);
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    checkStatus();

    // Register service worker if available
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Intercept any 423 Locked responses globally to trigger unlock modal immediately
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 423) {
        setIsVaultUnlocked(false);
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // Check vault status immediately whenever user returns to the tab or focus is regained
  useEffect(() => {
    const handleVisibilityOrFocus = async () => {
      if (document.visibilityState === "visible" && isAuthenticated) {
        try {
          const res = await fetch("/api/auth/me");
          if (res.ok) {
            const data = await res.json();
            setIsVaultUnlocked(Boolean(data.isVaultUnlocked));
          } else if (res.status === 401) {
            setIsAuthenticated(false);
          }
        } catch {}
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [isAuthenticated]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setIsAuthenticated(false);
  };

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(getNotificationPermission());
    if (granted) {
      await displayWebNotification({
        title: "TextPup Notifications Enabled! 🐶🔔",
        body: "You'll receive desktop alerts whenever text messages arrive.",
      });
    }
  };

  const notificationBanner =
    isAuthenticated && notifPermission === "default" && !bannerDismissed ? (
      <div className="bg-gradient-to-r from-accent-primary to-indigo-600 text-white text-xs px-4 py-2.5 flex items-center justify-between shadow-xs z-30 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 shrink-0 animate-bounce" />
          <span className="font-medium">
            Enable web notifications to get desktop alerts when new text messages arrive.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleEnableNotifications}
            className="px-3 py-1 rounded-lg bg-white text-accent-primary font-bold hover:bg-white/90 text-xs shadow-xs cursor-pointer transition-colors"
          >
            Enable Notifications
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            className="p-1 hover:bg-white/20 rounded-md cursor-pointer text-white/80 transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    ) : null;

  // Loading Splash Screen
  if (isInitialized === null || isAuthenticated === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app text-text-primary">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/icons/logo.png"
            alt="TextPup"
            className="w-20 h-20 object-contain animate-bounce"
          />
          <p className="text-xs font-semibold text-text-muted">Loading TextPup...</p>
        </div>
      </div>
    );
  }

  // 1. Setup Wizard Flow
  if (!isInitialized) {
    return <SetupWizard onComplete={() => checkStatus()} />;
  }

  // 2. Authentication Flow
  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={() => checkStatus()} />;
  }

  // 3. Main Application Flow
  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onLogout={handleLogout}
      isHostOnline={isHostOnline}
      batteryPercent={batteryPercent}
      unreadTotal={totalUnread}
      topBanner={notificationBanner}
    >
      {activeTab === "dashboard" && (
        <DashboardView
          onNavigate={setActiveTab}
          isHostOnline={isHostOnline}
          batteryPercent={batteryPercent}
          lastPingAt={lastPingAt}
          simLabels={simLabels}
        />
      )}

      {activeTab === "messages" && (
        <MessengerView
          key={`messages-${isVaultUnlocked}`}
          onUnreadChange={setTotalUnread}
          simLabels={simLabels}
          isVaultUnlocked={isVaultUnlocked}
        />
      )}

      {activeTab === "contacts" && (
        <ContactsView
          onStartChat={(_phone) => {
            setActiveTab("messages");
          }}
          simLabels={simLabels}
        />
      )}


      {activeTab === "settings" && (
        <SettingsView
          isHostOnline={isHostOnline}
          batteryPercent={batteryPercent}
          lastPingAt={lastPingAt}
          simLabels={simLabels}
          onUpdateSimLabels={updateSimLabels}
        />
      )}

      {/* Zero-knowledge Vault Unlock Modal */}
      <VaultUnlockModal
        isOpen={!isVaultUnlocked}
        onUnlocked={() => {
          setIsVaultUnlocked(true);
        }}
      />
    </AppShell>
  );
}
