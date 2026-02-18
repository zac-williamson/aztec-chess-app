import React from "react";
import type { BotDifficulty } from "../lib/types";

interface BotDifficultyPickerProps {
  onSelect: (difficulty: BotDifficulty) => void;
  disabled?: boolean;
}

const DIFFICULTIES: { value: BotDifficulty; label: string; desc: string }[] = [
  { value: "easy", label: "Easy", desc: "Casual play" },
  { value: "medium", label: "Medium", desc: "Some challenge" },
  { value: "hard", label: "Hard", desc: "Strong play" },
];

export function BotDifficultyPicker({ onSelect, disabled }: BotDifficultyPickerProps) {
  return (
    <div className="bot-difficulty-picker">
      {DIFFICULTIES.map((d) => (
        <button
          key={d.value}
          className={`btn btn-secondary btn-sm difficulty-btn difficulty-${d.value}`}
          onClick={() => onSelect(d.value)}
          disabled={disabled}
          title={d.desc}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
