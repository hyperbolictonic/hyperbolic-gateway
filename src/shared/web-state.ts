/** Page-level signals collected for the WEB STATE tab on the Command Deck. */
export interface WebPageState {
  url: string;
  host: string;
  title: string;
  /** URL path segments (the human's mental "breadcrumbs"). */
  crumbs: string[];
  cookies: { name: string; domain: string; httpOnly: boolean }[];
  /** localStorage entries (values truncated). */
  local: Record<string, string>;
  /** sessionStorage entries (values truncated). */
  session: Record<string, string>;
}
