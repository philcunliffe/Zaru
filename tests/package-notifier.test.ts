/**
 * Package notifier tests.
 *
 * Covers unread counter accounting and burst-coalescing behavior used by the
 * chat REPL when async packages arrive while the user is at the prompt.
 */

import { describe, test, expect } from "bun:test";
import {
  type PackageNotifierConfig,
  type PackageNotifierState,
  makePackageNotifierState,
  recordPackageArrival,
  flushPackageNotification,
  clearUnread,
  decrementUnread,
} from "../src/cli/package-notifier";

interface ManualClock {
  fire: () => void;
  hasPending: () => boolean;
  config: PackageNotifierConfig;
  messages: string[];
}

function manualClock(coalesceWindowMs = 500): ManualClock {
  let pending: (() => void) | null = null;
  let nextHandle = 1;
  const messages: string[] = [];
  const config: PackageNotifierConfig = {
    coalesceWindowMs,
    emit: (m) => messages.push(m),
    setTimeoutFn: (fn) => {
      pending = fn;
      return nextHandle++ as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {
      pending = null;
    },
  };
  return {
    fire: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    hasPending: () => pending !== null,
    config,
    messages,
  };
}

describe("recordPackageArrival", () => {
  test("increments unread count on each arrival", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    recordPackageArrival(state, "ijklmnop-rest", clock.config);
    expect(state.unreadCount).toBe(2);
  });

  test("does not emit until the coalesce window elapses", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    expect(clock.messages).toEqual([]);
    expect(clock.hasPending()).toBe(true);
  });

  test("a single arrival emits a singular notification with id prefix", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    clock.fire();
    expect(clock.messages.length).toBe(1);
    expect(clock.messages[0]).toBe(
      "[*] New package received (id: abcdefgh) -- 1 unread",
    );
  });

  test("multiple rapid arrivals coalesce into one notification", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "id-one-x", clock.config);
    recordPackageArrival(state, "id-two-x", clock.config);
    recordPackageArrival(state, "id-three-x", clock.config);
    expect(clock.messages).toEqual([]);
    expect(state.unreadCount).toBe(3);
    clock.fire();
    expect(clock.messages.length).toBe(1);
    expect(clock.messages[0]).toBe(
      "[*] 3 new packages received -- 3 unread",
    );
  });

  test("notification reflects total unread across bursts", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "first-id-x", clock.config);
    clock.fire();
    expect(clock.messages.length).toBe(1);
    recordPackageArrival(state, "second-x", clock.config);
    recordPackageArrival(state, "third-id", clock.config);
    clock.fire();
    expect(clock.messages.length).toBe(2);
    expect(clock.messages[1]).toBe(
      "[*] 2 new packages received -- 3 unread",
    );
  });

  test("uses leading-edge windowing — second arrival does not reset the timer", () => {
    const state = makePackageNotifierState();
    let pending: (() => void) | null = null;
    const setCalls: number[] = [];
    let nextHandle = 1;
    const messages: string[] = [];
    const config: PackageNotifierConfig = {
      coalesceWindowMs: 500,
      emit: (m) => messages.push(m),
      setTimeoutFn: (fn, ms) => {
        setCalls.push(ms);
        pending = fn;
        return nextHandle++ as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {
        pending = null;
      },
    };
    recordPackageArrival(state, "first-id-x", config);
    recordPackageArrival(state, "second-id", config);
    recordPackageArrival(state, "third-id-x", config);
    // Only the first arrival scheduled a timer.
    expect(setCalls).toEqual([500]);
    pending?.();
    expect(messages.length).toBe(1);
    expect(messages[0]).toBe("[*] 3 new packages received -- 3 unread");
  });

  test("coalesced notification shows the latest package id when count is 1", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "first-id-rest", clock.config);
    expect(clock.hasPending()).toBe(true);
    // Burst window reset (single arrival in second window after a flush)
    clock.fire();
    expect(clock.messages[0]).toContain("first-id");
  });
});

describe("flushPackageNotification", () => {
  test("is a no-op when no pending notification", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    flushPackageNotification(state, clock.config);
    expect(clock.messages).toEqual([]);
  });

  test("forces emission of a pending notification immediately", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    expect(clock.messages).toEqual([]);
    flushPackageNotification(state, clock.config);
    expect(clock.messages.length).toBe(1);
    expect(clock.hasPending()).toBe(false);
  });

  test("subsequent arrival starts a fresh window", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    flushPackageNotification(state, clock.config);
    expect(clock.hasPending()).toBe(false);

    recordPackageArrival(state, "ijklmnop-rest", clock.config);
    expect(clock.hasPending()).toBe(true);
  });
});

describe("clearUnread / decrementUnread", () => {
  test("clearUnread resets to zero", () => {
    const state: PackageNotifierState = {
      unreadCount: 7,
      pending: null,
      timer: null,
    };
    clearUnread(state);
    expect(state.unreadCount).toBe(0);
  });

  test("decrementUnread reduces the counter by one", () => {
    const state: PackageNotifierState = {
      unreadCount: 3,
      pending: null,
      timer: null,
    };
    decrementUnread(state);
    expect(state.unreadCount).toBe(2);
  });

  test("decrementUnread never goes below zero", () => {
    const state: PackageNotifierState = {
      unreadCount: 0,
      pending: null,
      timer: null,
    };
    decrementUnread(state);
    expect(state.unreadCount).toBe(0);
  });

  test("clearUnread does not emit any pending notification", () => {
    const state = makePackageNotifierState();
    const clock = manualClock();
    recordPackageArrival(state, "abcdefgh-rest", clock.config);
    clearUnread(state);
    // Counter cleared but the pending notification is still scheduled.
    // (Caller is expected to flush before clearing if it wants the message.)
    expect(state.unreadCount).toBe(0);
    expect(clock.hasPending()).toBe(true);
  });
});

describe("real-timer integration", () => {
  test("real setTimeout fires the notification after the window", async () => {
    const state = makePackageNotifierState();
    const messages: string[] = [];
    const config: PackageNotifierConfig = {
      coalesceWindowMs: 20,
      emit: (m) => messages.push(m),
    };
    recordPackageArrival(state, "abcdefgh-rest", config);
    recordPackageArrival(state, "ijklmnop-rest", config);
    expect(messages).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.length).toBe(1);
    expect(messages[0]).toBe(
      "[*] 2 new packages received -- 2 unread",
    );
  });
});
