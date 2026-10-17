import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { frontmatterBoundary } from "./editor-state.ts";
import { imageURL } from "./links.ts";

export function DocumentPreview({
  raw,
  path,
  title,
}: {
  raw: string;
  path: string;
  title: string;
}) {
  const body = raw.slice(frontmatterBoundary(raw));
  return (
    <article className="document-preview" aria-label={`Preview ${title}`}>
      {body.trim() ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(event) => {
                  if (!href || href.startsWith("#")) return;
                  event.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent("fable:open-link", { detail: href }),
                  );
                }}
              >
                {children}
              </a>
            ),
            img: ({ src, alt }) => {
              const url =
                src && (/^https?:/i.test(src) ? src : imageURL(path, src));
              return url ? (
                <img src={url} alt={alt ?? ""} loading="lazy" />
              ) : (
                <span>{alt || "Image unavailable"}</span>
              );
            },
          }}
        >
          {body}
        </ReactMarkdown>
      ) : (
        <p className="document-preview-empty">
          This page is empty. Switch to the live editor to start writing.
        </p>
      )}
    </article>
  );
}
