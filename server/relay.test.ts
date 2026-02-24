import { describe, it, expect } from "vitest";
import { isForwardableMessage } from "./relay";

describe("isForwardableMessage", () => {
  it("accepts MOVE messages", () => {
    expect(
      isForwardableMessage({
        type: "MOVE",
        moveNumber: 0,
        userOutputState: {},
        gameEnded: false,
      })
    ).toBe(true);
  });

  it("accepts MOVE_PROVEN messages", () => {
    expect(
      isForwardableMessage({ type: "MOVE_PROVEN", moveNumber: 1, blockNumber: 42 })
    ).toBe(true);
  });

  it("accepts MOVE_FAILED messages", () => {
    expect(
      isForwardableMessage({ type: "MOVE_FAILED", moveNumber: 1, reason: "timeout" })
    ).toBe(true);
  });

  it("accepts EMOTE messages", () => {
    expect(isForwardableMessage({ type: "EMOTE", emote: "👋" })).toBe(true);
  });

  it("rejects JOIN messages (handled separately)", () => {
    expect(
      isForwardableMessage({ type: "JOIN", gameId: 1, role: "white" })
    ).toBe(false);
  });

  it("rejects PEER_CONNECTED (server-originated)", () => {
    expect(isForwardableMessage({ type: "PEER_CONNECTED" })).toBe(false);
  });

  it("rejects PEER_DISCONNECTED (server-originated)", () => {
    expect(isForwardableMessage({ type: "PEER_DISCONNECTED" })).toBe(false);
  });

  it("rejects unknown message types", () => {
    expect(isForwardableMessage({ type: "HACK" })).toBe(false);
    expect(isForwardableMessage({ type: "RESET_GAME" })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isForwardableMessage(null)).toBe(false);
    expect(isForwardableMessage(undefined)).toBe(false);
    expect(isForwardableMessage("MOVE")).toBe(false);
    expect(isForwardableMessage(42)).toBe(false);
  });

  it("rejects objects without a type field", () => {
    expect(isForwardableMessage({ moveNumber: 1 })).toBe(false);
    expect(isForwardableMessage({})).toBe(false);
  });

  it("rejects objects with non-string type", () => {
    expect(isForwardableMessage({ type: 123 })).toBe(false);
    expect(isForwardableMessage({ type: true })).toBe(false);
  });
});
