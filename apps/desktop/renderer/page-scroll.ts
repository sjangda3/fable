export const PAGE_SCROLL_DISTANCE = 360;
export const PAGE_SCROLL_IDLE = 240;
const PAGE_SCROLL_COOLDOWN = 900;

export interface PageScrollState {
  distance: number;
  lastAt: number;
  cooldownUntil: number;
}
export const emptyPageScroll: PageScrollState = {
  distance: 0,
  lastAt: 0,
  cooldownUntil: 0,
};

/** Releasing an unfinished gesture clears it and returns the view slightly upward. */
export function releasePageScroll(state: PageScrollState, now: number) {
  const progress = Math.min(1, state.distance / PAGE_SCROLL_DISTANCE);
  return {
    state: { ...state, distance: 0, lastAt: now },
    rebound: progress > 0 ? 32 + progress * 32 : 0,
  };
}

/** Only deliberate extra scrolling at the end of the notebook creates a sheet. */
export function advancePageScroll(
  state: PageScrollState,
  delta: number,
  atEnd: boolean,
  now: number,
) {
  if (!atEnd || delta <= 0 || now < state.cooldownUntil)
    return {
      state: { ...state, distance: 0, lastAt: now },
      progress: 0,
      add: false,
    };
  const distance =
    (now - state.lastAt > PAGE_SCROLL_IDLE ? 0 : state.distance) + delta;
  if (distance >= PAGE_SCROLL_DISTANCE)
    return {
      state: {
        distance: 0,
        lastAt: now,
        cooldownUntil: now + PAGE_SCROLL_COOLDOWN,
      },
      progress: 1,
      add: true,
    };
  return {
    state: { ...state, distance, lastAt: now },
    progress: distance / PAGE_SCROLL_DISTANCE,
    add: false,
  };
}
