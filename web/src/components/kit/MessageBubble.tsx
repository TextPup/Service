import React, { useState } from "react";
import {
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  FileText,
  Download,
  Play,
  RotateCcw,
} from "lucide-react";
import { Lightbox } from "./Lightbox";

export interface AttachmentItem {
  id: string;
  kind: "image" | "video" | "audio" | "document";
  mimeType: string;
  filename: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  hasThumb: boolean;
  thumbUrl: string | null;
  mediaUrl: string;
}

export interface MessageItem {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  simNumber: number;
  body: string | null;
  status: "pending" | "sent" | "delivered" | "failed" | "received";
  errorReason: string | null;
  createdAt: number;
  attachments?: AttachmentItem[];
}

interface MessageBubbleProps {
  message: MessageItem;
  onRetry?: (message: MessageItem) => void;
  simLabels?: Record<number, { label: string; color: string }>;
}

const isOnlyEmojis = (str?: string | null): boolean => {
  if (!str) return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u200D|\uFE0F|\s)+$/u;
  if (!emojiRegex.test(trimmed)) return false;
  try {
    const count = [...new Intl.Segmenter().segment(trimmed.replace(/\s+/g, ""))].length;
    return count >= 1 && count <= 3;
  } catch {
    return trimmed.length <= 8;
  }
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onRetry,
  simLabels,
}) => {
  const isOutbound = message.direction === "outbound";
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderStatusIcon = () => {
    switch (message.status) {
      case "pending":
        return <Clock className="w-3.5 h-3.5 opacity-70 animate-pulse" />;
      case "sent":
        return <Check className="w-3.5 h-3.5 opacity-70" />;
      case "delivered":
        return <CheckCheck className="w-3.5 h-3.5 opacity-90" />;
      case "failed":
        return (
          <button
            onClick={() => onRetry?.(message)}
            title={message.errorReason || "Failed to send. Click to retry."}
            className="flex items-center gap-1 text-rose-500 hover:text-rose-600"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
            <RotateCcw className="w-3 h-3 hover:rotate-180 transition-transform" />
          </button>
        );
      default:
        return null;
    }
  };

  const simLabel = simLabels?.[message.simNumber]?.label || `SIM ${message.simNumber}`;
  const isJumboEmoji = !message.attachments?.length && isOnlyEmojis(message.body);

  return (
    <div className={`flex flex-col mb-3 ${isOutbound ? "items-end" : "items-start"} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] ${
          isJumboEmoji
            ? "bg-transparent p-1 shadow-none"
            : `shadow-sm p-3 ${
                isOutbound
                  ? "bg-accent-primary text-white rounded-2xl rounded-br-xs"
                  : "bg-bubble-in text-text-primary rounded-2xl rounded-bl-xs border border-border-subtle"
              }`
        } select-text`}
      >
        {/* Attachments Section */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-2 mb-2">
            {message.attachments.map((att) => {
              if (att.kind === "image") {
                const previewSrc = att.thumbUrl || att.mediaUrl;
                return (
                  <div
                    key={att.id}
                    onClick={() => setLightboxSrc(att.mediaUrl)}
                    className="relative cursor-pointer overflow-hidden rounded-xl bg-black/10 group"
                  >
                    <img
                      src={previewSrc}
                      alt={att.filename}
                      className="max-h-60 w-auto object-cover rounded-xl transition-transform group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="px-2 py-1 text-[11px] font-medium text-white bg-black/60 rounded-md backdrop-blur-sm">
                        View Full Image
                      </span>
                    </div>
                  </div>
                );
              }

              if (att.kind === "video") {
                return (
                  <div key={att.id} className="rounded-xl overflow-hidden bg-black/10">
                    <video
                      src={att.mediaUrl}
                      controls
                      poster={att.thumbUrl || undefined}
                      className="max-h-64 w-full rounded-xl"
                    />
                  </div>
                );
              }

              if (att.kind === "audio") {
                return (
                  <div
                    key={att.id}
                    className={`p-2 rounded-xl flex items-center gap-2 ${
                      isOutbound ? "bg-white/10" : "bg-app"
                    }`}
                  >
                    <Play className="w-4 h-4 shrink-0" />
                    <audio src={att.mediaUrl} controls className="h-8 w-48 max-w-full" />
                  </div>
                );
              }

              // Document / vCard / Generic
              return (
                <a
                  key={att.id}
                  href={att.mediaUrl}
                  download={att.filename}
                  className={`flex items-center justify-between gap-3 p-2.5 rounded-xl transition-colors ${
                    isOutbound
                      ? "bg-white/15 hover:bg-white/25 text-white"
                      : "bg-app hover:bg-border-subtle text-text-primary"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-5 h-5 shrink-0 opacity-80" />
                    <div className="truncate text-left">
                      <p className="text-xs font-semibold truncate">{att.filename}</p>
                      <p className="text-[10px] opacity-70">{formatFileSize(att.sizeBytes)}</p>
                    </div>
                  </div>
                  <Download className="w-4 h-4 shrink-0 opacity-80" />
                </a>
              );
            })}
          </div>
        )}

        {/* Message Text Body */}
        {message.body && (
          <p
            className={`${
              isJumboEmoji
                ? "text-4xl py-0.5 leading-none"
                : "text-sm whitespace-pre-wrap break-words leading-relaxed"
            }`}
          >
            {message.body}
          </p>
        )}

        {/* Footer: SIM slot, timestamp & delivery checkmark */}
        <div
          className={`flex items-center gap-1.5 mt-1 text-[10px] ${
            isOutbound ? "text-white/80 justify-end" : "text-text-muted justify-start"
          }`}
        >
          <span>{simLabel}</span>
          <span>•</span>
          <span>{formatTime(message.createdAt)}</span>
          {isOutbound && <span className="ml-0.5">{renderStatusIcon()}</span>}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
};
