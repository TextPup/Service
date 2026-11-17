import React, { useState, useEffect, useRef } from "react";
import { ThreadCard, type ThreadItem } from "../components/kit/ThreadCard";
import { MessageBubble, type MessageItem } from "../components/kit/MessageBubble";
import { PillComposer, type PendingAttachment } from "../components/kit/PillComposer";
import { useEvents } from "../hooks/useEvents";
import {
  Search,
  Plus,
  ArrowLeft,
  Trash2,
  Phone,
  MessageSquareOff,
  X,
  Lock,
  Shield,
} from "lucide-react";

interface MessengerViewProps {
  onUnreadChange?: (totalUnread: number) => void;
  simLabels?: Record<number, { label: string; color: string }>;
  onOpenNewChatModal?: () => void;
  isVaultUnlocked?: boolean;
}

export const MessengerView: React.FC<MessengerViewProps> = ({
  onUnreadChange,
  simLabels,
  isVaultUnlocked = true,
}) => {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // New Chat Modal state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState("");
  const [newChatText, setNewChatText] = useState("");
  const [newChatSim, setNewChatSim] = useState(1);
  const [isStartingChat, setIsStartingChat] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (smooth = false) => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
  };

  // Fetch Thread List
  const fetchThreads = async () => {
    try {
      const res = await fetch("/api/threads");
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
        const total = (data.threads || []).reduce(
          (sum: number, t: ThreadItem) => sum + (t.unreadCount || 0),
          0
        );
        onUnreadChange?.(total);
      }
    } catch (err) {
      console.error("Error fetching threads:", err);
    } finally {
      setLoadingThreads(false);
    }
  };

  useEffect(() => {
    fetchThreads();
  }, []);

  useEffect(() => {
    if (isVaultUnlocked) {
      fetchThreads();
    }
  }, [isVaultUnlocked]);

  // Real-time EventSource listener
  useEvents({
    onMessageNew: (ev) => {
      // If belongs to currently open thread, add to messages
      if (selectedThreadId === ev.threadId) {
        if (ev.hasAttachment) {
          fetchMessages(selectedThreadId);
        } else {
          setMessages((prev) => {
            if (prev.some((m) => m.id === ev.messageId)) return prev;
            return [
              ...prev,
              {
                id: ev.messageId,
                threadId: ev.threadId,
                direction: ev.direction,
                simNumber: ev.simNumber,
                body: ev.body,
                status: ev.direction === "outbound" ? "pending" : "received",
                errorReason: null,
                createdAt: ev.createdAt,
                attachments: [],
              },
            ];
          });
        }
      }
      fetchThreads();
    },
    onMessageStatus: (ev) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === ev.messageId
            ? { ...m, status: ev.status, errorReason: ev.errorReason || null }
            : m
        )
      );
    },
    onThreadUpdate: () => {
      fetchThreads();
    },
  });


  // Fetch Messages for active thread
  const fetchMessages = async (threadId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        // Mark as read
        await fetch(`/api/threads/${threadId}/read`, { method: "POST" });
        // Update local thread unread
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, unreadCount: 0 } : t))
        );
      }
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (selectedThreadId) {
      fetchMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId]);

  // Scroll to bottom when conversation loads or messages update
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      // Immediate scroll to bottom
      scrollToBottom(false);
      // Secondary check after layout/images render
      const timer = setTimeout(() => scrollToBottom(false), 50);
      return () => clearTimeout(timer);
    }
  }, [messages, loadingMessages]);

  // Send message handler
  const handleSendMessage = async (
    text: string,
    simNumber: number,
    attachments: PendingAttachment[]
  ) => {
    if (!selectedThreadId) return;

    const payload = {
      text,
      simNumber,
      attachments: attachments.map((a) => ({
        name: a.name,
        contentType: a.contentType,
        data: a.dataBase64,
      })),
    };

    const res = await fetch(`/api/threads/${selectedThreadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      fetchThreads();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Send failed: ${err.error || "Network error"}`);
    }
  };

  // Start new conversation
  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatPhone.trim() || isStartingChat) return;

    setIsStartingChat(true);
    try {
      const res = await fetch("/api/threads/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newChatPhone.trim(),
          text: newChatText.trim() || undefined,
          simNumber: newChatSim,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setShowNewChatModal(false);
        setNewChatPhone("");
        setNewChatText("");
        await fetchThreads();
        setSelectedThreadId(data.threadId);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Error: ${err.error || "Failed to start thread"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsStartingChat(false);
    }
  };

  // Delete Thread
  const handleDeleteThread = async (threadId: string) => {
    if (!confirm("Are you sure you want to delete this conversation and purge media files?")) {
      return;
    }
    const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedThreadId(null);
      fetchThreads();
    }
  };

  const selectedThread = threads.find((t) => t.id === selectedThreadId);

  const filteredThreads = threads.filter((t) => {
    const q = searchQuery.toLowerCase();
    const name = (t.displayName || "").toLowerCase();
    const phone = t.phone.toLowerCase();
    const preview = (t.lastPreview || "").toLowerCase();
    return name.includes(q) || phone.includes(q) || preview.includes(q);
  });

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden">
      {/* 1. Left Thread List Panel (340px desktop, full-width mobile if no active thread) */}
      <div
        className={`flex flex-col h-full bg-sidebar border-r border-border-subtle shrink-0 transition-all ${
          selectedThreadId ? "hidden md:flex md:w-85" : "flex w-full md:w-85"
        }`}
      >
        {/* Thread List Header & Search */}
        <div className="p-3.5 border-b border-border-subtle flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary">Messages</h2>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-app border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-accent-primary"
            />
          </div>
        </div>

        {/* Thread List Items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingThreads || !isVaultUnlocked ? (
            <div className="space-y-2 p-1">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-app/60 border border-border-subtle/50 animate-pulse"
                >
                  <div className="w-11 h-11 rounded-full bg-border-subtle/70 shrink-0" />
                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="h-3.5 bg-border-subtle/80 rounded-full w-28" />
                      <div className="h-2.5 bg-border-subtle/50 rounded-full w-10" />
                    </div>
                    <div className="h-2.5 bg-border-subtle/50 rounded-full w-40" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">
              {searchQuery ? "No matching conversations" : "No messages yet. Start a new chat!"}
            </div>
          ) : (
            filteredThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                isActive={thread.id === selectedThreadId}
                onClick={() => setSelectedThreadId(thread.id)}
                simLabels={simLabels}
              />
            ))
          )}
        </div>
      </div>

      {/* 2. Active Chat Panel */}
      <div
        className={`flex-1 flex flex-col h-full bg-canvas overflow-hidden ${
          !selectedThreadId ? "hidden md:flex" : "flex"
        }`}
      >
        {selectedThreadId && selectedThread ? (
          <>
            {/* Active Chat Header */}
            <header className="flex items-center justify-between px-4 py-3 bg-sidebar border-b border-border-subtle shrink-0">
              <div className="flex items-center gap-3">
                {/* Back button on mobile */}
                <button
                  onClick={() => setSelectedThreadId(null)}
                  className="flex md:hidden p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-app"
                  title="Back to conversations"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div
                  className="flex items-center justify-center w-10 h-10 rounded-full font-bold text-white text-sm shadow-sm"
                  style={{ backgroundColor: selectedThread.avatarColor || "#5B5CE6" }}
                >
                  {(selectedThread.displayName || selectedThread.phone)
                    .replace(/^\+/, "")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>

                <div>
                  <h3 className="text-sm font-bold text-text-primary">
                    {selectedThread.displayName || selectedThread.phone}
                  </h3>
                  {selectedThread.displayName && (
                    <p className="text-[11px] text-text-muted">{selectedThread.phone}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`tel:${selectedThread.phone}`}
                  className="p-2 rounded-xl text-text-secondary hover:text-accent-primary hover:bg-app transition-colors"
                  title="Call Phone Number"
                >
                  <Phone className="w-4 h-4" />
                </a>

                <button
                  onClick={() => handleDeleteThread(selectedThread.id)}
                  className="p-2 rounded-xl text-text-secondary hover:text-rose-500 hover:bg-app transition-colors"
                  title="Delete Conversation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Message Timeline */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMessages ? (
                /* Staggered Animated Skeleton Message Timeline */
                <div className="space-y-4 py-2 animate-pulse select-none">
                  <div className="flex flex-col items-start space-y-1">
                    <div className="h-10 w-48 rounded-2xl rounded-bl-xs bg-border-subtle/60" />
                    <div className="h-2 w-16 bg-border-subtle/30 rounded-full" />
                  </div>
                  <div className="flex flex-col items-end space-y-1">
                    <div className="h-14 w-64 rounded-2xl rounded-br-xs bg-accent-soft/70" />
                    <div className="h-2 w-20 bg-border-subtle/30 rounded-full" />
                  </div>
                  <div className="flex flex-col items-start space-y-1">
                    <div className="h-9 w-36 rounded-2xl rounded-bl-xs bg-border-subtle/60" />
                    <div className="h-2 w-14 bg-border-subtle/30 rounded-full" />
                  </div>
                  <div className="flex flex-col items-end space-y-1">
                    <div className="h-12 w-56 rounded-2xl rounded-br-xs bg-accent-soft/70" />
                    <div className="h-2 w-16 bg-border-subtle/30 rounded-full" />
                  </div>
                  <div className="flex flex-col items-start space-y-1">
                    <div className="h-16 w-72 rounded-2xl rounded-bl-xs bg-border-subtle/60" />
                    <div className="h-2 w-24 bg-border-subtle/30 rounded-full" />
                  </div>
                  <div className="flex flex-col items-end space-y-1">
                    <div className="h-10 w-40 rounded-2xl rounded-br-xs bg-accent-soft/70" />
                    <div className="h-2 w-16 bg-border-subtle/30 rounded-full" />
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-xs text-text-muted">No messages in this thread</div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    simLabels={simLabels}
                    onRetry={() => {
                      if (msg.body) handleSendMessage(msg.body, msg.simNumber, []);
                    }}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Pill Composer Footer */}
            <PillComposer
              onSend={handleSendMessage}
              defaultSimNumber={selectedThread.lastSimNumber || 1}
              simLabels={simLabels}
            />
          </>
        ) : !isVaultUnlocked ? (
          /* Locked Vault Placeholder State */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-muted relative overflow-hidden">
            <div className="absolute inset-0 flex flex-col justify-around p-8 opacity-15 blur-xs select-none pointer-events-none">
              <div className="h-10 w-48 rounded-2xl bg-border-subtle self-start" />
              <div className="h-12 w-64 rounded-2xl bg-accent-soft self-end" />
              <div className="h-8 w-36 rounded-2xl bg-border-subtle self-start" />
              <div className="h-14 w-56 rounded-2xl bg-accent-soft self-end" />
            </div>

            <div className="relative z-10 flex flex-col items-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4 shadow-sm ring-4 ring-amber-500/5 animate-pulse">
                <Lock className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-text-primary mb-1.5">
                Crypto Vault is Locked
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Your conversations, message history, and contacts are protected at rest with zero-knowledge AES-256-GCM encryption.
              </p>
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full">
                <Shield className="w-3.5 h-3.5" />
                <span>Enter Master Password to Unlock</span>
              </div>
            </div>
          </div>
        ) : (
          /* Empty placeholder when no chat selected */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-muted">
            <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center text-accent-primary mb-3">
              <MessageSquareOff className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-text-primary mb-1">No conversation selected</h3>
            <p className="text-xs text-text-secondary max-w-xs mb-4">
              Select an existing conversation from the list or start a new chat.
            </p>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Start New Conversation</span>
            </button>
          </div>
        )}
      </div>

      {/* New Conversation Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border-subtle shadow-card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
              <h3 className="text-sm font-bold text-text-primary">Start New Conversation</h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-app"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleStartNewChat} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Recipient Phone Number
                </label>
                <input
                  type="tel"
                  value={newChatPhone}
                  onChange={(e) => setNewChatPhone(e.target.value)}
                  placeholder="+1 (334) 555-0199"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary font-mono focus:outline-accent-primary"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Initial Message (Optional)
                </label>
                <textarea
                  value={newChatText}
                  onChange={(e) => setNewChatText(e.target.value)}
                  placeholder="Type a message to send immediately..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Select Sending SIM
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewChatSim(1)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      newChatSim === 1
                        ? "bg-sim1-bg text-sim1-text border border-sim1-text/30"
                        : "bg-app text-text-secondary border border-border-subtle"
                    }`}
                  >
                    {simLabels?.[1]?.label || "SIM 1"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChatSim(2)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      newChatSim === 2
                        ? "bg-sim2-bg text-sim2-text border border-sim2-text/30"
                        : "bg-app text-text-secondary border border-border-subtle"
                    }`}
                  >
                    {simLabels?.[2]?.label || "SIM 2"}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-text-secondary hover:bg-app"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isStartingChat || !newChatPhone.trim()}
                  className="px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isStartingChat ? "Starting..." : "Start Chat"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
