import type { ReactNode } from "react";
import {
  Document,
  Font,
  Image,
  Link,
  Page,
  pdf,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes, Root, Definition, PhrasingContent } from "mdast";
import { imageURL } from "./links.ts";
import type { NotebookExportPage } from "./notebook-export.ts";
import regularFont from "./assets/pdf/Geist-Regular.ttf?url";
import semiboldFont from "./assets/pdf/Geist-SemiBold.ttf?url";
import italicFont from "./assets/pdf/Geist-Italic.ttf?url";
import semiboldItalicFont from "./assets/pdf/Geist-SemiBoldItalic.ttf?url";

Font.register({
  family: "Geist",
  fonts: [
    { src: regularFont, fontWeight: 400 },
    { src: semiboldFont, fontWeight: 600 },
    { src: italicFont, fontWeight: 400, fontStyle: "italic" },
    { src: semiboldItalicFont, fontWeight: 600, fontStyle: "italic" },
  ],
});

const parser = unified().use(remarkParse).use(remarkGfm);
const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 11,
    lineHeight: 1.65,
    color: "#202020",
    padding: 48,
  },
  paragraph: { marginBottom: 12 },
  heading: {
    fontWeight: 600,
    lineHeight: 1.25,
    marginBottom: 12,
    marginTop: 8,
  },
  code: {
    fontFamily: "Courier",
    fontSize: 9,
    lineHeight: 1.5,
    backgroundColor: "#f7f7f7",
    padding: 12,
    marginBottom: 12,
    borderRadius: 4,
  },
  inlineCode: {
    fontFamily: "Courier",
    fontSize: 10,
    backgroundColor: "#f1f1f1",
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: "#dedede",
    paddingLeft: 12,
    marginBottom: 12,
    color: "#666666",
  },
  list: { marginBottom: 8 },
  listRow: { flexDirection: "row", marginBottom: 4 },
  marker: { width: 24, flexShrink: 0, fontSize: 10 },
  listBody: { flex: 1 },
  image: {
    maxWidth: "100%",
    maxHeight: 640,
    objectFit: "contain",
    marginBottom: 12,
  },
  imageAlt: { fontSize: 10, color: "#666666", marginBottom: 12 },
  table: { marginBottom: 12, borderWidth: 0.5, borderColor: "#dedede" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dedede",
  },
  tableCell: { flex: 1, padding: 8, fontSize: 9, lineHeight: 1.5 },
  tableHeader: { backgroundColor: "#f7f7f7", fontWeight: 600 },
  rule: { height: 1, backgroundColor: "#dedede", marginVertical: 12 },
});

type Context = {
  images: Map<string, string>;
  definitions: Map<string, Definition>;
};
function visit(node: Nodes, callback: (node: Nodes) => void) {
  callback(node);
  if ("children" in node)
    node.children.forEach((child) => visit(child, callback));
}
function contextFor(tree: Root, images: Map<string, string>): Context {
  const definitions = new Map<string, Definition>();
  visit(tree, (node) => {
    if (node.type === "definition")
      definitions.set(node.identifier.toLowerCase(), node);
  });
  return { images, definitions };
}
const safeLink = (url: string | undefined) =>
  url && /^(https?:|mailto:|tel:)/i.test(url) ? url : undefined;

function inline(nodes: PhrasingContent[], context: Context): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "inlineCode":
        return (
          <Text key={index} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case "strong":
        return (
          <Text key={index} style={{ fontWeight: 600 }}>
            {inline(node.children, context)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={index} style={{ fontStyle: "italic" }}>
            {inline(node.children, context)}
          </Text>
        );
      case "delete":
        return (
          <Text key={index} style={{ textDecoration: "line-through" }}>
            {inline(node.children, context)}
          </Text>
        );
      case "break":
        return "\n";
      case "link":
      case "linkReference": {
        const url = safeLink(
          node.type === "link"
            ? node.url
            : context.definitions.get(node.identifier.toLowerCase())?.url,
        );
        return url ? (
          <Link
            key={index}
            src={url}
            style={{ color: "#202020", textDecoration: "underline" }}
          >
            {inline(node.children, context)}
          </Link>
        ) : (
          <Text key={index}>{inline(node.children, context)}</Text>
        );
      }
      case "footnoteReference":
        return <Text key={index}>[{node.identifier}]</Text>;
      case "image":
      case "imageReference":
        return node.alt ?? "";
      default:
        return null;
    }
  });
}
function paragraph(children: PhrasingContent[], context: Context, key: string) {
  const parts: ReactNode[] = [];
  let text: PhrasingContent[] = [];
  const flush = () => {
    if (text.length)
      parts.push(
        <Text
          key={`text-${parts.length}`}
          style={styles.paragraph}
          orphans={2}
          widows={2}
        >
          {inline(text, context)}
        </Text>,
      );
    text = [];
  };
  for (const child of children) {
    if (child.type !== "image" && child.type !== "imageReference") {
      text.push(child);
      continue;
    }
    flush();
    const url =
      child.type === "image"
        ? child.url
        : context.definitions.get(child.identifier.toLowerCase())?.url;
    const src = url && context.images.get(url);
    parts.push(
      src ? (
        <Image key={`image-${parts.length}`} src={src} style={styles.image} />
      ) : (
        <Text key={`alt-${parts.length}`} style={styles.imageAlt}>
          {child.alt || "Image unavailable"}
        </Text>
      ),
    );
  }
  flush();
  return <View key={key}>{parts}</View>;
}
function blocks(nodes: Nodes[], context: Context, prefix = ""): ReactNode {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    switch (node.type) {
      case "heading":
        return (
          <Text
            key={key}
            style={[
              styles.heading,
              { fontSize: [26, 20, 16, 14, 12, 11][node.depth - 1] },
            ]}
            minPresenceAhead={32}
          >
            {inline(node.children, context)}
          </Text>
        );
      case "paragraph":
        return paragraph(node.children, context, key);
      case "code":
        return (
          <Text key={key} style={styles.code} orphans={2} widows={2}>
            {node.value}
          </Text>
        );
      case "blockquote":
        return (
          <View key={key} style={styles.quote}>
            {blocks(node.children, context, `${key}-`)}
          </View>
        );
      case "list":
        return (
          <View key={key} style={styles.list}>
            {node.children.map((item, i) => (
              <View key={i} style={styles.listRow}>
                <Text style={styles.marker}>
                  {typeof item.checked === "boolean"
                    ? item.checked
                      ? "[x]"
                      : "[ ]"
                    : node.ordered
                      ? `${(node.start ?? 1) + i}.`
                      : "•"}
                </Text>
                <View style={styles.listBody}>
                  {blocks(item.children, context, `${key}-${i}-`)}
                </View>
              </View>
            ))}
          </View>
        );
      case "table":
        return (
          <View key={key} style={styles.table}>
            {node.children.map((row, r) => (
              <View
                key={r}
                style={[
                  styles.tableRow,
                  ...(r === 0 ? [styles.tableHeader] : []),
                ]}
                minPresenceAhead={r === 0 ? 24 : 0}
              >
                {row.children.map((cell, c) => (
                  <Text
                    key={c}
                    style={[
                      styles.tableCell,
                      { textAlign: node.align?.[c] ?? "left" },
                    ]}
                  >
                    {inline(cell.children, context)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      case "thematicBreak":
        return <View key={key} style={styles.rule} />;
      case "footnoteDefinition":
        return (
          <View key={key}>
            <Text style={{ fontSize: 9 }}>[{node.identifier}]</Text>
            {blocks(node.children, context, `${key}-`)}
          </View>
        );
      default:
        return null;
    }
  });
}

export function NotebookPDFDocument({
  title,
  pages,
  images = new Map(),
}: {
  title: string;
  pages: NotebookExportPage[];
  images?: Map<string, string>;
}) {
  return (
    <Document title={title} creator="Fable" producer="Fable" language="en">
      {pages.map((page) => {
        const tree = parser.parse(page.raw);
        return (
          <Page key={page.number} size="A4" style={styles.page} wrap>
            {blocks(tree.children, contextFor(tree, images))}
          </Page>
        );
      })}
    </Document>
  );
}

async function exportImage(path: string, href: string) {
  const url = /^(https?:|data:image\/)/i.test(href)
    ? href
    : imageURL(path, href);
  if (!url) return undefined;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
}

export async function createNotebookPDF({
  title,
  path,
  pages,
}: {
  title: string;
  path: string;
  pages: NotebookExportPage[];
}) {
  if (!pages.length) throw new Error("Pick at least one page to download.");
  const urls = new Set<string>();
  for (const page of pages) {
    const tree = parser.parse(page.raw),
      context = contextFor(tree, new Map());
    visit(tree, (node) => {
      if (node.type === "image") urls.add(node.url);
      if (node.type === "imageReference") {
        const url = context.definitions.get(node.identifier.toLowerCase())?.url;
        if (url) urls.add(url);
      }
    });
  }
  const images = new Map<string, string>();
  for (const url of urls) {
    const image = await exportImage(path, url);
    if (image) images.set(url, image);
  }
  return pdf(
    <NotebookPDFDocument title={title} pages={pages} images={images} />,
  ).toBlob();
}
