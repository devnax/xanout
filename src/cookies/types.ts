export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  partitioned?: boolean;
}

export interface Cookies {
  get(name: string): string | undefined;
  has(name: string): boolean;
  all(): Record<string, string>;
  set(name: string, value: string, options?: CookieOptions): Cookies;
  delete(
    name: string,
    options?: Pick<CookieOptions, "path" | "domain">,
  ): Cookies;
}
