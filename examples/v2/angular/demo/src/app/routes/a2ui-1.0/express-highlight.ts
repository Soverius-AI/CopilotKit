import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import type { LanguageFn } from "highlight.js";

/** Presentation only: the SDK compiler remains responsible for DSL validation. */
export const expressLanguage: LanguageFn = (api) => ({
  name: "A2UI Express",
  aliases: ["a2ui-express"],
  disableAutodetect: true,
  keywords: { literal: "true false null" },
  contains: [
    { scope: "meta", begin: /<\/?a2ui>/ },
    { scope: "string", begin: /r"""/, end: /"""/ },
    {
      scope: "string",
      begin: /"""/,
      end: /"""/,
      contains: [api.BACKSLASH_ESCAPE],
    },
    { scope: "string", begin: /r"/, end: /"/ },
    api.QUOTE_STRING_MODE,
    { scope: "variable", begin: /\$(?:\/[\w~./-]*|[A-Za-z_][\w~./-]*)?/ },
    { scope: "keyword", begin: /\broot\b/ },
    { scope: "built_in", begin: /\b(?:Event|surface|_template)\b(?=\s*\()/ },
    { scope: "built_in", begin: /\?[A-Za-z_]\w*/ },
    { scope: "title.function", begin: /\b[A-Z][A-Za-z0-9_]*(?=\s*\()/ },
    { scope: "built_in", begin: /\b[a-z_]\w*(?=\s*\()/ },
    { scope: "attr", begin: /\b[A-Za-z_]\w*(?=\s*=)/ },
    api.C_NUMBER_MODE,
  ],
});

// Keep this grammar independent of the chat renderer's registered languages.
const highlighter = hljs.newInstance();
highlighter.registerLanguage("a2ui-express", expressLanguage);
highlighter.registerLanguage("json", json);

export function highlightExpress(source: string): string {
  return highlighter.highlight(source, {
    language: "a2ui-express",
    ignoreIllegals: true,
  }).value;
}

export function highlightJson(source: string): string {
  return highlighter.highlight(source, {
    language: "json",
    ignoreIllegals: true,
  }).value;
}
