import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😊",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰",
      "😘", "😗", "😙", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨",
      "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕",
      "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟",
      "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣",
      "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👹"
    ],
  },
  {
    name: "Gestures",
    icon: "👍",
    emojis: [
      "👍", "👎", "👊", "✊", "🤛", "🤜", "🤞", "✌️", "🤟", "🤘", "👌", "🤌", "🤏", "👈", "👉", "👆",
      "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤙", "💪", "🦾", "🖕", "✍️", "🙏", "🤝", "👏", "🙌"
    ],
  },
  {
    name: "Animals",
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
      "🐧", "🐦", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜",
      "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊"
    ],
  },
  {
    name: "Hearts",
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
      "💘", "💝", "💟", "🔥", "✨", "🌟", "💫", "⭐️", "💥", "💯", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇"
    ],
  },
  {
    name: "Objects",
    icon: "📱",
    emojis: [
      "📱", "💻", "⌨️", "🖥️", "📷", "📸", "📹", "💡", "🔦", "📖", "📚", "✏️", "📝", "💼", "📦", "🔑",
      "🚗", "🚕", "🚙", "🚀", "✈️", "☕️", "🍺", "🍕", "🍔", "🍟", "🌮", "🍦", "🎂", "🍿", "🍩", "🍎"
    ],
  },
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelectEmoji,
  isOpen,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentEmojis = search.trim()
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((emoji) => emoji.includes(search.trim()))
    : EMOJI_CATEGORIES[activeCategory].emojis;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-16 left-2 z-50 w-72 sm:w-80 rounded-2xl bg-sidebar border border-border-subtle shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 select-none"
    >
      {/* Category Tabs */}
      <div className="flex items-center justify-between p-2 bg-app border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => {
                setActiveCategory(idx);
                setSearch("");
              }}
              className={`p-1.5 rounded-lg text-sm transition-all cursor-pointer ${
                activeCategory === idx && !search
                  ? "bg-accent-soft text-accent-primary scale-110 shadow-xs"
                  : "hover:bg-border-subtle/50 opacity-70 hover:opacity-100"
              }`}
              title={cat.name}
            >
              <span>{cat.icon}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-border-subtle cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-border-subtle bg-sidebar">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emojis..."
            className="w-full pl-8 pr-3 py-1 text-xs rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
            autoFocus
          />
        </div>
      </div>

      {/* Emoji Grid */}
      <div className="p-2 max-h-56 overflow-y-auto grid grid-cols-7 sm:grid-cols-8 gap-1.5">
        {currentEmojis.map((emoji, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              onSelectEmoji(emoji);
            }}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-lg hover:bg-app hover:scale-125 transition-transform cursor-pointer"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
