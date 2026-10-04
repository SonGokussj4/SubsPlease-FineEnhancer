/** Ambient declarations for the Tampermonkey APIs the userscript @grants.
 * Used only by `make typecheck`; not shipped with the script. */

interface GMXmlHttpRequestResponse {
  status: number;
  statusText?: string;
  responseText: string;
  responseHeaders?: string;
  finalUrl?: string;
}

interface GMXmlHttpRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  onload?: (response: GMXmlHttpRequestResponse) => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

declare function GM_xmlhttpRequest(options: GMXmlHttpRequestOptions): void;
declare function GM_getValue<T>(name: string, defaultValue: T): T;
declare function GM_getValue(name: string): unknown;
declare function GM_setValue(name: string, value: unknown): void;
declare function GM_deleteValue(name: string): void;
declare function GM_registerMenuCommand(caption: string, onClick: () => void, accessKey?: string): number;
declare function GM_openInTab(url: string, options?: { active?: boolean; insert?: boolean; setParent?: boolean }): void;
