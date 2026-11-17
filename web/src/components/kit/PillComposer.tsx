import React, { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X, FileText, Smile } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";


export interface PendingAttachment {
  file: File;
  name: string;
  contentType: string;
  dataBase64: string;
  previewUrl?: string;
  sizeBytes: number;
}

interface PillComposerProps {
  onSend: (text: string, simNumber: number, attachments: PendingAttachment[]) => Promise<void>;
  defaultSimNumber: number;
  simLabels?: Record<number, { label: string; color: string }>;
  disabled?: boolean;
}

export const PillComposer: React.FC<PillComposerProps> = ({
  onSend,
  defaultSimNumber,
  simLabels,
  disabled = false,
}) => {
  const [text, setText] = useState("");
  const [simNumber, setSimNumber] = useState(defaultSimNumber || 1);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectEmoji = (emoji: string) => {
    if (textareaRef.current) {
      const el = textareaRef.current;
      const start = el.selectionStart || text.length;
      const end = el.selectionEnd || text.length;
      const updated = text.slice(0, start) + emoji + text.slice(end);
      setText(updated);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + emoji.length, start + emoji.length);
      });
    } else {
      setText((prev) => prev + emoji);
    }
  };

  // Sync default SIM if conversation changes
  useEffect(() => {
    setSimNumber(defaultSimNumber || 1);
  }, [defaultSimNumber]);

  // Toggle SIM
  const toggleSim = () => {
    setSimNumber((prev) => (prev === 1 ? 2 : 1));
  };

  // Convert File to base64
  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1] || "";
      const isImg = file.type.startsWith("image/");

      setAttachments((prev) => [
        ...prev,
        {
          file,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          dataBase64: base64Data,
          previewUrl: isImg ? result : undefined,
          sizeBytes: file.size,
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(processFile);
  };

  // Clipboard paste support (Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    let foundFile = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) {
          processFile(file);
          foundFile = true;
        }
      }
    }
    if (foundFile) {
      e.preventDefault();
    }
  };

  // Drag & drop support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSending || disabled) return;

    setIsSending(true);
    try {
      await onSend(trimmed, simNumber, attachments);
      setText("");
      setAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsSending(false);
    }
  };

  const simConfig = simLabels?.[simNumber] || {
    label: `SIM ${simNumber}`,
    color: simNumber === 1 ? "var(--sim1-text)" : "var(--sim2-text)",
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative p-2 md:p-3 bg-sidebar border-t border-border-subtle transition-colors ${
        isDragging ? "bg-accent-soft border-accent-primary" : ""
      }`}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFiles(e.target.files)}
        multiple
        className="hidden"
      />

      {/* Attachment Previews Strip */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 overflow-x-auto py-1">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="relative flex items-center gap-2 p-1.5 pr-6 rounded-xl bg-app border border-border-subtle shrink-0 shadow-sm"
            >
              {att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  className="w-10 h-10 object-cover rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-border-subtle flex items-center justify-center">
                  <FileText className="w-5 h-5 text-text-muted" />
                </div>
              )}
              <div className="max-w-32 truncate text-left">
                <p className="text-xs font-semibold truncate text-text-primary">{att.name}</p>
                <p className="text-[10px] text-text-muted">
                  {Math.round(att.sizeBytes / 1024)} KB
                </p>
              </div>
              <button
                onClick={() => removeAttachment(idx)}
                className="absolute top-1.5 right-1.5 p-1 rounded-full bg-border-subtle hover:bg-rose-500 hover:text-white text-text-muted transition-colors"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Full Rounded-Full Pill Composer */}
      <div className="relative flex items-center gap-1.5 sm:gap-2 bg-app-input rounded-full p-1.5 pl-2.5 border border-border-subtle focus-within:border-accent-primary transition-all">
        {/* Emoji Picker Popover */}
        <EmojiPicker
          isOpen={showEmojiPicker}
          onClose={() => setShowEmojiPicker(false)}
          onSelectEmoji={handleSelectEmoji}
        />

        {/* Attachment Paperclip Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending}
          className="p-1.5 sm:p-2 rounded-full text-text-secondary hover:text-accent-primary hover:bg-app transition-colors"
          title="Attach photo, video, audio or document"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Emoji Button */}
        <button
          type="button"
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          disabled={disabled || isSending}
          className={`p-1.5 sm:p-2 rounded-full transition-colors ${
            showEmojiPicker
              ? "text-accent-primary bg-accent-soft"
              : "text-text-secondary hover:text-accent-primary hover:bg-app"
          }`}
          title="Insert emoji"
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* 1-Tap SIM 1 / SIM 2 Toggle Capsule */}
        <button
          type="button"
          onClick={toggleSim}
          disabled={disabled || isSending}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-transform active:scale-95 shadow-xs ${
            simNumber === 1
              ? "bg-sim1-bg text-sim1-text hover:brightness-95"
              : "bg-sim2-bg text-sim2-text hover:brightness-95"
          }`}
          title="Click to toggle sending SIM"
        >
          <span>{simConfig.label}</span>
        </button>

        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Text message (SMS / MMS)..."
          disabled={disabled || isSending}
          rows={1}
          className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-text-primary placeholder:text-text-muted max-h-32 py-2 px-1 leading-relaxed"
        />

        {/* Circular Send Button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={(!text.trim() && attachments.length === 0) || isSending || disabled}
          className={`flex items-center justify-center w-10 h-10 rounded-full text-white shadow-md transition-all shrink-0 ${
            (!text.trim() && attachments.length === 0) || isSending || disabled
              ? "bg-text-muted opacity-50 cursor-not-allowed"
              : "bg-accent-primary hover:bg-accent-hover hover:scale-105 active:scale-95 cursor-pointer"
          }`}
          title="Send Message"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
};
