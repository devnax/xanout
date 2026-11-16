/**
 * Merge ctx.headers() and the cookies queued by ctx.cookies() into the final Response.
 * Context headers win over same-named headers on the response.
 */
export function mergeIntoResponse(
  res: Response,
  resHeaders: Headers,
  cookies: string[],
): Response {
  const extraCookies = resHeaders.getSetCookie();
  let has = cookies.length > 0 || extraCookies.length > 0;
  resHeaders.forEach((_v, k) => {
    if (k !== "set-cookie") has = true;
  });
  if (!has) return res;

  const apply = (h: Headers) => {
    resHeaders.forEach((v, k) => {
      if (k !== "set-cookie") h.set(k, v);
    });
    for (const c of extraCookies) h.append("set-cookie", c);
    for (const c of cookies) h.append("set-cookie", c);
  };

  try {
    apply(res.headers);
    return res;
  } catch {
    // immutable headers (Response.redirect(), fetch() results): rebuild
    const h = new Headers(res.headers);
    apply(h);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: h,
    });
  }
}
