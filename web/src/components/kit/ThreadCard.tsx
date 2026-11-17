import React from "react";

export interface ThreadItem {
  id: string;
  phone: string;
  displayName: string | null;
  avatarColor: string;
  lastSimNumber: number;
  lastPreview: string | null;
  lastThumbAttachmentId: string | null;
  lastMessageAt: number;
  unreadCount: number;
}

interface ThreadCardProps {
  thread: ThreadItem;
  isActive: boolean;
  onClick: () => void;
  simLabels?: Record<number, { label: string; color: string }>;
}

export const ThreadCard: React.FC<ThreadCardProps> = ({
  thread,
  isActive,
  onClick,
  simLabels,
}) => {
  const title = thread.displayName || thread.phone;
  const initials = (thread.displayName || thread.phone)
    .replace(/^\+/, "")
    .slice(0, 2)
    .toUpperCase();

  // Format timestamp
  const formatTime = (ts: number) => {
    if (!ts) return "";
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const isThisYear = date.getFullYear() === now.getFullYear();
    if (isThisYear) {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
  };

  const simConfig = simLabels?.[thread.lastSimNumber] || {
    label: `SIM ${thread.lastSimNumber}`,
    color: thread.lastSimNumber === 1 ? "var(--sim1-text)" : "var(--sim2-text)",
  };

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
        isActive
          ? "bg-accent-soft text-text-primary shadow-sm"
          : "hover:bg-app text-text-secondary hover:text-text-primary"
      }`}
    >
      {/* 44px Avatar Monogram */}
      <div
        className="relative flex items-center justify-center w-11 h-11 shrink-0 rounded-full font-bold text-white text-sm shadow-sm"
        style={{ backgroundColor: thread.avatarColor || "#5B5CE6" }}
      >
        {initials}
      </div>

      {/* Middle Text Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <h4
            className={`text-sm truncate ${
              thread.unreadCount > 0 ? "font-bold text-text-primary" : "font-medium"
            }`}
          >
            {title}
          </h4>
          <span className="text-[11px] text-text-muted shrink-0">
            {formatTime(thread.lastMessageAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p
            className={`text-xs truncate ${
              thread.unreadCount > 0 ? "text-text-primary font-semibold" : "text-text-muted"
            }`}
          >
            {thread.lastPreview || "No messages yet"}
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Colored SIM Badge */}
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                thread.lastSimNumber === 1 ? "bg-sim1-bg text-sim1-text" : "bg-sim2-bg text-sim2-text"
              }`}
            >
              {simConfig.label}
            </span>

            {/* Unread count pill */}
            {thread.unreadCount > 0 && (
              <span className="flex items-center justify-center min-w-4.5 h-4.5 px-1 text-[11px] font-bold text-white bg-accent-primary rounded-full shadow-sm">
                {thread.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 36px x 36px Thumbnail Preview if media present */}
      {thread.lastThumbAttachmentId && (
        <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden border border-border-subtle bg-app">
          <img
            src={`/api/media/${thread.lastThumbAttachmentId}?variant=thumb`}
            alt="Preview"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
};
