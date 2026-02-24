import React, { useState, useCallback, useEffect } from "react";
import { EMOTES } from "../lib/types";
import type { Emote } from "../lib/types";

interface EmoteBarProps {
  onSendEmote: (emote: Emote) => void;
  receivedEmote: Emote | null;
  disabled?: boolean;
}

export function EmoteBar({ onSendEmote, receivedEmote, disabled = false }: EmoteBarProps) {
  const [showReceived, setShowReceived] = useState<Emote | null>(null);
  const [cooldown, setCooldown] = useState(false);

  // Show received emote with auto-dismiss
  useEffect(() => {
    if (!receivedEmote) return;
    setShowReceived(receivedEmote);
    const timer = setTimeout(() => setShowReceived(null), 2500);
    return () => clearTimeout(timer);
  }, [receivedEmote]);

  const handleSend = useCallback(
    (emote: Emote) => {
      if (disabled || cooldown) return;
      onSendEmote(emote);
      // Brief cooldown to prevent spam
      setCooldown(true);
      setTimeout(() => setCooldown(false), 1500);
    },
    [onSendEmote, disabled, cooldown]
  );

  return (
    <div className="emote-bar">
      <div className="emote-buttons">
        {EMOTES.map((emote) => (
          <button
            key={emote}
            className="emote-btn"
            onClick={() => handleSend(emote)}
            disabled={disabled || cooldown}
            title={`Send ${emote}`}
          >
            {emote}
          </button>
        ))}
      </div>
      {showReceived && (
        <div className="emote-received animate-emote-pop" key={Date.now()}>
          <span className="emote-received-emoji">{showReceived}</span>
        </div>
      )}
    </div>
  );
}
