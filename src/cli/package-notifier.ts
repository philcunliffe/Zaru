/**
 * Package notification state machine.
 *
 * Tracks the unread package counter for the chat REPL and coalesces rapid
 * arrivals so a burst only emits a single notification line.
 *
 * Pure logic only — no I/O. The caller supplies an `emit` callback that
 * actually prints the message and (typically) redraws the readline prompt.
 */

export interface PackageNotifierState {
  unreadCount: number;
  pending: { count: number; lastPackageId: string } | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PackageNotifierConfig {
  coalesceWindowMs: number;
  emit: (message: string) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function makePackageNotifierState(): PackageNotifierState {
  return { unreadCount: 0, pending: null, timer: null };
}

export function recordPackageArrival(
  state: PackageNotifierState,
  packageId: string,
  config: PackageNotifierConfig,
): void {
  state.unreadCount += 1;

  if (state.pending) {
    // A burst is already in progress. Coalesce into it without restarting
    // the timer — leading-edge windowing guarantees the notification fires
    // even under sustained arrivals.
    state.pending.count += 1;
    state.pending.lastPackageId = packageId;
    return;
  }

  const setT = config.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  state.pending = { count: 1, lastPackageId: packageId };
  state.timer = setT(() => flushPackageNotification(state, config), config.coalesceWindowMs);
}

export function flushPackageNotification(
  state: PackageNotifierState,
  config: PackageNotifierConfig,
): void {
  if (state.timer !== null) {
    const clearT = config.clearTimeoutFn ?? ((h) => clearTimeout(h));
    clearT(state.timer);
    state.timer = null;
  }
  if (!state.pending) return;

  const { count, lastPackageId } = state.pending;
  state.pending = null;

  const idPrefix = lastPackageId.slice(0, 8);
  const message = count === 1
    ? `[*] New package received (id: ${idPrefix}) -- ${state.unreadCount} unread`
    : `[*] ${count} new packages received -- ${state.unreadCount} unread`;

  config.emit(message);
}

export function clearUnread(state: PackageNotifierState): void {
  state.unreadCount = 0;
}

export function decrementUnread(state: PackageNotifierState): void {
  state.unreadCount = Math.max(0, state.unreadCount - 1);
}
