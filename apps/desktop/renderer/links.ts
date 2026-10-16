export function resolveVaultLink(source: string, href: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//"))
    return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split("#")[0]);
  } catch {
    return undefined;
  }
  const parts = source.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
export function relativeVaultHref(source: string, target: string) {
  const from = source.split("/").slice(0, -1),
    to = target.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to]
    .map((part) =>
      encodeURIComponent(part).replaceAll("(", "%28").replaceAll(")", "%29"),
    )
    .join("/");
}
export function imageURL(source: string, href: string) {
  const path = resolveVaultLink(source, href);
  if (!path || !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path))
    return undefined;
  return window.fable
    ? `fable-asset://vault/?path=${encodeURIComponent(path)}`
    : `/api/asset?path=${encodeURIComponent(path)}`;
}
