import { codeToHtml, bundledLanguages } from "shiki";
import { nodeSchema, safeURL, textOf, type ContentNode } from "./index";
export const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
export type TocItem = { id: string; text: string; level: 2 | 3 };
export async function renderContent(input: unknown) {
  const root = nodeSchema.parse(input);
  const toc: TocItem[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  let count = 0;
  async function render(node: ContentNode, depth = 0): Promise<string> {
    if (depth > 40 || ++count > 10000)
      throw new Error("Content exceeds safe rendering limits.");
    const children = async () =>
      (
        await Promise.all(
          (node.children ?? []).map((child) => render(child, depth + 1)),
        )
      ).join("");
    if (node.type === "text" || node.type === "code-highlight") {
      let value = escapeHTML(node.text ?? "");
      const format = typeof node.format === "number" ? node.format : 0;
      if (format & 16) value = `<code>${value}</code>`;
      if (format & 1) value = `<strong>${value}</strong>`;
      if (format & 2) value = `<em>${value}</em>`;
      if (format & 4) value = `<s>${value}</s>`;
      if (format & 8) value = `<u>${value}</u>`;
      if (format & 32) value = `<sub>${value}</sub>`;
      if (format & 64) value = `<sup>${value}</sup>`;
      return value;
    }
    if (node.type === "root") return children();
    if (node.type === "paragraph") return `<p>${await children()}</p>`;
    if (node.type === "heading") {
      const level = node.tag === "h3" ? 3 : 2;
      const base =
        textOf(node)
          .normalize("NFC")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "section";
      const number = (seen.get(base) ?? 0) + 1;
      seen.set(base, number);
      const id = number === 1 ? base : `${base}-${number}`;
      toc.push({ id, text: textOf(node), level });
      return `<h${level} id="${escapeHTML(id)}">${await children()}</h${level}>`;
    }
    if (node.type === "linebreak") return "<br>";
    if (node.type === "horizontalrule") return "<hr>";
    if (node.type === "quote")
      return `<blockquote>${await children()}</blockquote>`;
    if (node.type === "list") {
      const tag = node.listType === "number" ? "ol" : "ul";
      return `<${tag}>${await children()}</${tag}>`;
    }
    if (node.type === "listitem") return `<li>${await children()}</li>`;
    if (node.type === "link" || node.type === "autolink") {
      const url = node.fields?.url ?? node.url ?? "";
      const inner = await children();
      return safeURL(url)
        ? `<a href="${escapeHTML(url)}"${(node.fields?.newTab ?? node.newTab) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`
        : inner;
    }
    if (
      node.type === "code" ||
      (node.type === "block" && node.fields?.blockType === "code")
    ) {
      const source =
        node.fields?.code ?? (node.children ?? []).map(textOf).join("");
      const requested = node.fields?.language ?? node.language ?? "text";
      const lang = requested in bundledLanguages ? requested : "text";
      const html = await codeToHtml(source, {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
      });
      return `<div class="code-block"><div class="code-toolbar"><span>${escapeHTML(lang)}</span><button type="button" class="copy-code" hidden aria-label="複製程式碼">複製</button><span class="copy-status" role="status" aria-live="polite"></span></div>${html}</div>`;
    }
    if (node.type === "table")
      return `<div class="table-scroll" role="region" aria-label="文章表格" tabindex="0"><table>${await children()}</table></div>`;
    if (node.type === "tablerow") return `<tr>${await children()}</tr>`;
    if (node.type === "tablecell" || node.type === "tableheader") {
      const tag = node.type === "tableheader" ? "th" : "td";
      return `<${tag}${tag === "th" ? ' scope="col"' : ""}>${await children()}</${tag}>`;
    }
    if ((node.type === "image" || node.type === "upload") && node.image) {
      const image = node.image;
      return `<figure><img src="${escapeHTML(image.url)}" alt="${escapeHTML(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></figure>`;
    }
    warnings.push(node.type);
    return `<div class="unsupported-node" role="note"><span>未支援的內容區塊</span>${await children()}${escapeHTML(node.text ?? "")}</div>`;
  }
  // Render sequentially at the root so heading anchors retain document order.
  const chunks: string[] = [];
  for (const child of root.children ?? []) chunks.push(await render(child));
  return { html: chunks.join(""), toc, warnings };
}
