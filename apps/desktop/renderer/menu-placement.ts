type Size = { width: number; height: number };
type Point = { left: number; top: number };
const gutter = 8;
const fit = (value: number, length: number, available: number) =>
  Math.max(gutter, Math.min(value, available - length - gutter));

export function placeMenu(anchor: Point, size: Size, viewport: Size): Point {
  return {
    left: fit(anchor.left, size.width, viewport.width),
    top: fit(anchor.top, size.height, viewport.height),
  };
}

export function placeSubmenu(
  parent: { left: number; right: number; top: number },
  size: Size,
  viewport: Size,
) {
  const right = parent.right + 4;
  const opensLeft = right + size.width > viewport.width - gutter;
  return {
    ...placeMenu(
      {
        left: opensLeft ? parent.left - size.width - 4 : right,
        top: parent.top - 4,
      },
      size,
      viewport,
    ),
    opensLeft,
  };
}
