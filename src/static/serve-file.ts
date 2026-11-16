import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "../context/context.js";
import { MIME } from "./mime.js";

interface ServeFileOptions {
  dir: string;
  index: string | false;
  dotfiles?: boolean;
  cacheControl: string;
}

export async function serveFile(
  options: ServeFileOptions,
  { pathname, method, request }: Context,
): Promise<Response | undefined> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (rel.includes("\0")) return undefined;
  if (!options.dotfiles && rel.split(/[\\/]/).some((seg) => seg.startsWith(".")))
    return undefined;

  const root = resolve(options.dir);
  let file = resolve(root, "." + sep + rel);
  if (file !== root && !file.startsWith(root + sep)) return undefined;

  let st = await stat(file).catch(() => null);
  if (st?.isDirectory()) {
    if (!options.index) return undefined;
    file = join(file, options.index);
    st = await stat(file).catch(() => null);
  }
  if (!st?.isFile()) return undefined;

  const ext = extname(file).slice(1).toLowerCase();
  const headers = new Headers({
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": options.cacheControl,
    "Last-Modified": st.mtime.toUTCString(),
    ETag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
  });

  if (request.headers.get("if-none-match") === headers.get("ETag"))
    return new Response(null, { status: 304, headers });

  let status = 200,
    start = 0,
    end = st.size - 1;
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = +m[1];
        if (m[2]) end = Math.min(+m[2], end);
      } else {
        start = Math.max(st.size - +m[2], 0);
      }
      if (start > end || start >= st.size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${st.size}` },
        });
      }
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${st.size}`);
    }
  }
  headers.set("Content-Length", String(st.size === 0 ? 0 : end - start + 1));

  if (method === "HEAD" || st.size === 0)
    return new Response(null, { status, headers });
  const body = Readable.toWeb(createReadStream(file, { start, end }));
  return new Response(body as any, { status, headers });
}
