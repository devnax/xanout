export const isWebRequest = (x: any): x is Request =>
  (typeof Request !== "undefined" && x instanceof Request) ||
  (typeof x?.url === "string" &&
    typeof x?.method === "string" &&
    typeof x?.headers?.get === "function" &&
    typeof x?.arrayBuffer === "function");
