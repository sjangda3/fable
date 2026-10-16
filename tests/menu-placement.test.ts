import { expect, it } from "vitest";
import {
  placeMenu,
  placeSubmenu,
} from "../apps/desktop/renderer/menu-placement.ts";

it("keeps a right-click menu inside the window near either edge", () => {
  const size = { width: 256, height: 360 },
    viewport = { width: 700, height: 600 };
  expect(placeMenu({ left: 680, top: 590 }, size, viewport)).toEqual({
    left: 436,
    top: 232,
  });
  expect(placeMenu({ left: -10, top: -20 }, size, viewport)).toEqual({
    left: 8,
    top: 8,
  });
  expect(placeMenu({ left: 120, top: 64 }, size, viewport)).toEqual({
    left: 120,
    top: 64,
  });
});

it("opens submenus to the left when there is no space on the right and keeps the bottom visible", () => {
  const size = { width: 240, height: 200 },
    viewport = { width: 700, height: 600 };
  expect(
    placeSubmenu({ left: 436, right: 692, top: 500 }, size, viewport),
  ).toEqual({ left: 192, top: 392, opensLeft: true });
  expect(
    placeSubmenu({ left: 120, right: 376, top: 200 }, size, viewport),
  ).toEqual({ left: 380, top: 196, opensLeft: false });
});
