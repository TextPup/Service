import React from "react";
import { SidebarRail, type NavTab } from "./SidebarRail";
import { MessageSquare, Users, Settings, LayoutDashboard } from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
  isHostOnline?: boolean;
  batteryPercent?: number;
  unreadTotal?: number;
  hideSidebarOnMobile?: boolean;
  topBanner?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  activeTab,
  onTabChange,
  onLogout,
  isHostOnline = false,
  batteryPercent,
  unreadTotal = 0,
  hideSidebarOnMobile = false,
  topBanner,
}) => {
  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-screen bg-app text-text-primary p-0 md:p-3 gap-0 md:gap-3 overflow-hidden select-none">
      {/* Desktop Left Rail */}
      <SidebarRail
        activeTab={activeTab}
        onTabChange={onTabChange}
        onLogout={onLogout}
        isHostOnline={isHostOnline}
        batteryPercent={batteryPercent}
        unreadTotal={unreadTotal}
      />

      {/* Main Responsive Canvas */}
      <main className="flex-1 flex flex-col h-full overflow-hidden md:rounded-2xl bg-canvas border-0 md:border md:border-border-subtle md:shadow-card relative">
        {topBanner}
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar (Hidden when inside active chat if requested) */}
      {!hideSidebarOnMobile && (
        <nav className="flex md:hidden items-center justify-around h-14 bg-sidebar border-t border-border-subtle z-30 shrink-0">
          <button
            onClick={() => onTabChange("dashboard")}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 ${
              activeTab === "dashboard" ? "text-accent-primary font-semibold" : "text-text-secondary"
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Stats</span>
          </button>

          <button
            onClick={() => onTabChange("messages")}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 ${
              activeTab === "messages" ? "text-accent-primary font-semibold" : "text-text-secondary"
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5" />
              {unreadTotal > 0 && (
                <span className="absolute -top-1 -right-2 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold text-white bg-accent-primary rounded-full">
                  {unreadTotal}
                </span>
              )}
            </div>
            <span className="text-[11px] mt-0.5">Chats</span>
          </button>

          <button
            onClick={() => onTabChange("contacts")}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 ${
              activeTab === "contacts" ? "text-accent-primary font-semibold" : "text-text-secondary"
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Contacts</span>
          </button>

          <button
            onClick={() => onTabChange("settings")}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 ${
              activeTab === "settings" ? "text-accent-primary font-semibold" : "text-text-secondary"
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
};
