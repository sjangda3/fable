import { promises as fs } from "node:fs";
import { Note01Icon } from "@hugeicons/core-free-icons";
import { Resvg } from "@resvg/resvg-js";

// The artwork is the existing Hugeicons Note01 icon (MIT), not a second icon family.
const paths = Note01Icon.map(
  ([tag, attributes]) =>
    `<${tag} ${Object.entries(attributes)
      .filter(([k]) => k !== "key")
      .map(
        ([k, v]) =>
          `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}="${v}"`,
      )
      .join(" ")}/>`,
).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="72" y="72" width="880" height="880" rx="196" fill="#f7f7f7"/><g transform="translate(240 240) scale(22.66667)" fill="none" color="#555555">${paths}</g></svg>`;
await fs.mkdir("public", { recursive: true });
await fs.writeFile("public/favicon.svg", svg);
const pngs = new Map<number, Buffer>();
for (const size of [128, 256, 512, 1024])
  pngs.set(
    size,
    new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng(),
  );
await fs.writeFile("public/fable.png", pngs.get(512)!);
const chunks = [...pngs].map(([size, png]) => {
  const head = Buffer.alloc(8);
  head.write({ 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" }[size]!);
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
});
const icnsHead = Buffer.alloc(8);
icnsHead.write("icns");
icnsHead.writeUInt32BE(8 + chunks.reduce((n, b) => n + b.length, 0), 4);
await fs.writeFile("public/fable.icns", Buffer.concat([icnsHead, ...chunks]));
const png = pngs.get(256)!,
  ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await fs.writeFile("public/fable.ico", Buffer.concat([ico, png]));
