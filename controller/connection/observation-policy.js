// Fixed observation timing; normal completion must precede the overall backstop.
// The independent systemd process ceiling begins at exec, before these timers.
export const observationTiming = Object.freeze({ sessionMs: 150_000, deadlineMs: 175_000 })
