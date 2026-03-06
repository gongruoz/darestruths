require("dotenv").config();
const { Client } = require("@notionhq/client");
const express = require("express");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = "31a822d43844806b826ee4fa6fcb3802";
const app = express();
const PORT = process.env.PORT || 3000;

function getPlainText(richText) {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map((t) => t.plain_text || "").join("");
}

// Convert Notion rich_text to HTML, preserving links (原文中的超链接保留)
function richTextToHtml(richText) {
  if (!richText || !Array.isArray(richText)) return "";
  return richText
    .map((t) => {
      const text = t.plain_text || "";
      const url = t.href || t.link?.url || t.text?.link?.url;
      const escaped = escapeHtml(text);
      return url ? `<a href="${escapeHtml(url)}">${escaped}</a>` : escaped;
    })
    .join("");
}

function blockToHtml(block) {
  const type = block.type;
  const content = block[type];
  if (!content) return "";

  // Notion 图像：external URL 或 file URL
  if (type === "image") {
    // #region agent log
    try { fetch("http://127.0.0.1:7415/ingest/d5903de1-1d40-449c-a008-8e78e3d514a5", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1d20f9" }, body: JSON.stringify({ sessionId: "1d20f9", location: "server.js:blockToHtml:image", message: "image block", data: { hasExternal: !!content.external, hasFile: !!content.file, urlFromExternal: !!content.external?.url, urlFromFile: !!content.file?.url, keys: Object.keys(content) }, hypothesisId: "H3", timestamp: Date.now() }) }); } catch (_) {}
    // #endregion
    const url = content.external?.url || content.file?.url;
    if (!url) return "";
    const alt = getPlainText(content.caption) || "Image";
    return `<figure class="notion-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" /></figure>`;
  }

  const rich = content.rich_text || content.caption;
  const text = getPlainText(rich);
  if (!text.trim()) return "";

  const htmlContent = richTextToHtml(rich);

  switch (type) {
    case "heading_1":
      return `<h1>${htmlContent}</h1>`;
    case "heading_2":
      return `<h2>${htmlContent}</h2>`;
    case "heading_3":
      return `<h3>${htmlContent}</h3>`;
    case "bulleted_list_item":
      return `<li>${htmlContent}</li>`;
    case "numbered_list_item":
      return `<li>${htmlContent}</li>`;
    case "to_do":
      const checked = content.checked ? ' checked' : '';
      return `<p class="todo"><input type="checkbox" disabled${checked}> ${htmlContent}</p>`;
    case "quote":
      return `<blockquote>${htmlContent}</blockquote>`;
    case "code":
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
    case "paragraph":
    default:
      return `<p>${htmlContent}</p>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getBlockChildren(blockId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });
    blocks.push(...res.results);
    cursor = res.next_cursor;
  } while (cursor);
  return blocks;
}

/** 递归获取所有子块（含 column_list 等内部的 image），保持文档顺序 */
async function getAllBlocksFlat(blockId) {
  const top = await getBlockChildren(blockId);
  const out = [];
  for (const block of top) {
    out.push(block);
    if (block.has_children) {
      const nested = await getAllBlocksFlat(block.id);
      out.push(...nested);
    }
  }
  return out;
}

function getPageTitleFromProps(properties) {
  if (!properties) return "Untitled";
  const prop = properties.title || properties.Name || properties.name;
  if (prop?.title) return getPlainText(prop.title);
  if (prop?.rich_text) return getPlainText(prop.rich_text);
  const titleProp = Object.values(properties).find((p) => p.type === "title");
  if (titleProp?.title) return getPlainText(titleProp.title);
  return "Untitled";
}

async function fetchAsPage(pageId) {
  const out = { databaseTitle: "Home", sections: [] };
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const titleProp = Object.values(page.properties || {}).find((p) => p.type === "title");
    out.databaseTitle =
      (titleProp && getPlainText(titleProp.title || titleProp.rich_text)) || "Home";
    const blocks = await getAllBlocksFlat(pageId);
    // #region agent log
    const _dbg = (msg, data) => { try { fetch("http://127.0.0.1:7415/ingest/d5903de1-1d40-449c-a008-8e78e3d514a5", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1d20f9" }, body: JSON.stringify({ sessionId: "1d20f9", location: "server.js:fetchAsPage", message: msg, data: data || {}, hypothesisId: "H1", timestamp: Date.now() }) }); } catch (_) {} };
    _dbg("block types (with nested)", { types: blocks.map(b => b.type), imageCount: blocks.filter(b => b.type === "image").length });
    blocks.filter(b => b.type === "image").forEach((b, i) => { const c = b.image || {}; _dbg("image block structure", { index: i, contentKeys: Object.keys(c), externalUrl: c.external?.url ? "(present)" : null, fileUrl: c.file?.url ? "(present)" : null, raw: JSON.stringify(c).slice(0, 300) }); });
    // #endregion
    let html = "";
    let idx = 0;
    while (idx < blocks.length) {
      const part = blockToHtml(blocks[idx]);
      if (!part) { idx++; continue; }
      if (blocks[idx].type === "image") {
        let row = part;
        let j = idx + 1;
        while (j < blocks.length) {
          if (blocks[j].type === "image") {
            row += blockToHtml(blocks[j]);
            j++;
          } else if (blocks[j].type === "column_list" || blocks[j].type === "column") {
            j++;
          } else {
            break;
          }
        }
        html += `<div class="image-row">${row}</div>`;
        idx = j;
        continue;
      } else {
        html += part + "\n";
      }
      idx++;
    }
    if (blocks.some((b) => b.type === "bulleted_list_item" || b.type === "numbered_list_item")) {
      html = html.replace(/(<li>.*?<\/li>)+/gs, (match) => `<ul>${match}</ul>`);
    }
    // Single page: don't repeat title as section heading (title 不要重复显示两次)
    out.sections.push({ title: out.databaseTitle, html, id: pageId, skipTitle: true });
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

async function fetchAsDatabase(dbId) {
  const out = { databaseTitle: "", sections: [] };
  const db = await notion.databases.retrieve({ database_id: dbId });
  out.databaseTitle = db.title?.map((t) => t.plain_text).join("") || "Dares and Truths";
  const query = await notion.databases.query({
    database_id: dbId,
    page_size: 50,
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
  });
  for (const page of query.results) {
    const title = getPageTitleFromProps(page.properties) || "Untitled";
    const blocks = await getBlockChildren(page.id);
    let html = blocks.map(blockToHtml).filter(Boolean).join("\n");
    if (blocks.some((b) => b.type === "bulleted_list_item" || b.type === "numbered_list_item")) {
      html = html.replace(/(<li>.*?<\/li>)+/gs, (match) => `<ul>${match}</ul>`);
    }
    out.sections.push({ title, html, id: page.id });
  }
  return out;
}

async function fetchNotionContent() {
  // Your URL is a page: https://www.notion.so/dares-and-truths-31a822d43844806b826ee4fa6fcb3802
  // Try page first, then database if ID is actually a database.
  let data = await fetchAsPage(DATABASE_ID);
  if (data.error && (data.error.includes("Could not find page") || data.error.includes("object_not_found"))) {
    try {
      data = await fetchAsDatabase(DATABASE_ID);
    } catch (e) {
      data = { databaseTitle: "Home", sections: [], error: e.message || String(e) };
    }
  }
  return data;
}

function buildHtml(data) {
  const isNotionError =
    data.error &&
    (data.error.includes("Could not find") ||
      data.error.includes("object_not_found") ||
      data.error.includes("relevant pages and databases are shared"));
  const isTokenError =
    data.error &&
    (data.error.toLowerCase().includes("token") ||
      data.error.toLowerCase().includes("invalid") ||
      data.error.toLowerCase().includes("unauthorized") ||
      data.error.toLowerCase().includes("authorization"));
  const errorHtml = data.error
    ? isTokenError
      ? `<div class="error-box">
          <p class="error">${escapeHtml(data.error)}</p>
          <p><strong>Fix (e.g. on Vercel) / 解决方法：</strong></p>
          <ol>
            <li>Add <strong>NOTION_TOKEN</strong> in your host’s environment (e.g. Vercel → Project → Settings → Environment Variables). 在部署平台（如 Vercel）的项目设置里添加环境变量 <strong>NOTION_TOKEN</strong>。</li>
            <li>Redeploy after saving. 保存后重新部署。</li>
          </ol>
        </div>`
      : isNotionError
      ? `<div class="error-box">
          <p class="error">${escapeHtml(data.error)}</p>
          <p><strong>Fix / 解决方法：</strong></p>
          <ol>
            <li>Open the Notion page or database in your browser. 在浏览器中打开该 Notion 页面或数据库。</li>
            <li>Click <strong>⋯</strong> (top right) → <strong>Connections</strong> → connect your integration. 点击右上角 <strong>⋯</strong> → <strong>连接</strong> → 添加你的集成。</li>
            <li>Reload this site. 刷新本页面。</li>
          </ol>
        </div>`
      : `<p class="error">${escapeHtml(data.error)}</p>`
    : "";
  const sectionsHtml =
    data.error
      ? errorHtml
      : (data.sections || [])
          .map(
            (s) =>
              `<section>${s.skipTitle ? "" : `<h2>${escapeHtml(s.title)}</h2>`}<div class="content">${s.html || ""}</div></section>`
          )
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.databaseTitle || "Home")}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <h1>${escapeHtml(data.databaseTitle || "Home")}</h1>
    ${sectionsHtml}
  </main>
</body>
</html>`;
}

app.get("/style.css", (_, res) => {
  res.type("text/css").send(`
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #fff;
  color: #111;
  font-family: "PingFang SC", -apple-system, sans-serif;
  font-weight: 100;
  line-height: 1.6;
  padding: 3rem 2.5rem 4rem;
  max-width: 56rem;
  margin-left: auto;
  margin-right: auto;
}
main {
  padding-top: 10rem;
}
main h1 {
  font-size: 1.75rem;
  font-weight: 100;
  margin-top: 0;
  margin-bottom: 3rem;
}
a { color: #111; text-decoration: underline; }
a:hover { text-decoration: none; }
section { margin-bottom: 4rem; }
section h2 { font-size: 1.125rem; font-weight: 100; margin-bottom: 1rem; margin-top: 0; }
.content p { margin: 0.85rem 0; }
.content ul { margin: 0.85rem 0; padding-left: 1.5rem; }
.content li { margin: 0.4rem 0; }
.content blockquote { margin: 1rem 0; padding: 0.5rem 0 0.5rem 1.25rem; border-left: 2px solid #ccc; color: #333; }
.content pre { overflow: auto; padding: 1rem; background: #f5f5f5; font-size: 0.875rem; margin: 1rem 0; }
.content .todo { display: flex; align-items: center; gap: 0.6rem; }
.content .todo input { margin: 0; }
.error { color: #c00; }
.error-box { margin-top: 1.5rem; padding: 1.25rem; border: 1px solid #ccc; background: #fafafa; }
.error-box ol { margin: 0.6rem 0; padding-left: 1.5rem; }
.error-box li { margin: 0.4rem 0; }
.image-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 1.25rem; margin: 1.5rem 0; }
.image-row figure.notion-image { margin: 0; flex: 0 0 auto; width: 45%; max-width: 280px; }
figure.notion-image img { max-width: 100%; height: auto; display: block; }
`);
});

app.get("/", async (req, res) => {
  // #region agent log
  fetch("http://127.0.0.1:7415/ingest/d5903de1-1d40-449c-a008-8e78e3d514a5", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1d20f9" }, body: JSON.stringify({ sessionId: "1d20f9", location: "server.js:GET/", message: "GET / route hit", data: { url: req.url }, hypothesisId: "H5", timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  const data = await fetchNotionContent();
  res.type("html").send(buildHtml(data));
});

// Only start HTTP server when not on Vercel (serverless invokes the app per request)
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Server at http://localhost:${PORT}`);
  });
}

module.exports = app;
