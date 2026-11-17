import React from "react";
import {
  MessageSquare,
  Users,
  Settings,
  Sun,
  Moon,
  LogOut,
  Smartphone,
  LayoutDashboard,
} from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

export type NavTab = "dashboard" | "messages" | "contacts" | "settings";

interface SidebarRailProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
  isHostOnline?: boolean;
  batteryPercent?: number;
  unreadTotal?: number;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
  activeTab,
  onTabChange,
  onLogout,
  isHostOnline = false,
  batteryPercent,
  unreadTotal = 0,
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="hidden md:flex flex-col items-center justify-between w-18 py-4 bg-sidebar rounded-2xl border border-border-subtle shadow-card select-none">
      {/* Top Branding Mascot Logo */}
      <div className="flex flex-col items-center gap-6">
        <button
          onClick={() => onTabChange("messages")}
          className="group relative flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-[#5B5CE6] to-[#6366F1] shadow-md transition-transform hover:scale-105 active:scale-95 focus:outline-none"
          title="TextPup"
        >
          <img
            src="/icons/logo.png"
            alt="TextPup Logo"
            className="w-11 h-11 object-contain drop-shadow"
          />
        </button>

        {/* Primary Navigation Buttons */}
        <nav className="flex flex-col items-center gap-3">
          <button
            onClick={() => onTabChange("dashboard")}
            className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
              activeTab === "dashboard"
                ? "bg-accent-soft text-accent-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-app"
            }`}
            title="Dashboard & Analytics"
          >
            <LayoutDashboard className="w-5 h-5" />
          </button>

          <button
            onClick={() => onTabChange("messages")}
            className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
              activeTab === "messages"
                ? "bg-accent-soft text-accent-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-app"
            }`}
            title="Messages"
          >
            <MessageSquare className="w-5 h-5" />
            {unreadTotal > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 text-[11px] font-bold text-white bg-accent-primary rounded-full shadow-sm ring-2 ring-sidebar">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            )}
          </button>

          <button
            onClick={() => onTabChange("contacts")}
            className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
              activeTab === "contacts"
                ? "bg-accent-soft text-accent-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-app"
            }`}
            title="Contacts"
          >
            <Users className="w-5 h-5" />
          </button>

          <button
            onClick={() => onTabChange("settings")}
            className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
              activeTab === "settings"
                ? "bg-accent-soft text-accent-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-app"
            }`}
            title="Settings & SIMs"
          >
            <Settings className="w-5 h-5" />
          </button>
        </nav>
      </div>

      {/* Bottom Controls: Theme Toggle, Host Heartbeat & Logout */}
      <div className="flex flex-col items-center gap-4">
        {/* Host Phone Status Pill */}
        <div
          className="group relative flex flex-col items-center p-2 rounded-xl hover:bg-app transition-colors cursor-help"
          title={`Host Phone: ${isHostOnline ? "Online" : "Offline"}${
            batteryPercent !== undefined ? ` • ${batteryPercent}% Battery` : ""
          }`}
        >
          <div className="relative">
            <Smartphone className="w-5 h-5 text-text-secondary" />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-sidebar ${
                isHostOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
          </div>
          {batteryPercent !== undefined && (
            <span className="text-[10px] font-medium text-text-muted mt-1">
              {batteryPercent}%
            </span>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-10 h-10 rounded-xl text-text-secondary hover:text-text-primary hover:bg-app transition-colors"
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
        >
          {theme === "dark" ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="flex items-center justify-center w-10 h-10 rounded-xl text-text-secondary hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
          title="Log Out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
};
