// A tiny indirection over Date.now() so time-dependent rules (check-in
// windows, no-show release, booking windows) can be tested deterministically.
let fixed = null;

export const clock = {
  now() {
    return fixed ?? Date.now();
  },
  set(ms) {
    fixed = ms;
  },
  advance(ms) {
    fixed = (fixed ?? Date.now()) + ms;
  },
  reset() {
    fixed = null;
  },
};
