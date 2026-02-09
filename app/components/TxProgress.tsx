import React from "react";
import type { TxStep } from "../lib/types";

interface TxProgressProps {
  step: TxStep;
}

const STEPS: { key: TxStep; label: string }[] = [
  { key: "building", label: "Building transaction" },
  { key: "proving", label: "Generating proof" },
  { key: "confirming", label: "Waiting for confirmation" },
];

export function TxProgress({ step }: TxProgressProps) {
  const currentIdx = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="tx-progress">
      {STEPS.map((s, i) => {
        const isCompleted = i < currentIdx;
        const isActive = i === currentIdx;

        return (
          <div
            key={s.key}
            className={`tx-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""}`}
          >
            <div className="tx-step-indicator">
              {isCompleted ? (
                <span className="tx-step-check">&#10003;</span>
              ) : isActive ? (
                <div className="tx-step-spinner" />
              ) : (
                <span className="tx-step-number">{i + 1}</span>
              )}
            </div>
            <span className="tx-step-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
