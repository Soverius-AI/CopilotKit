const loopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

export interface HubModelSource {
  repoId: string;
  revision: string;
}

/** Hub files use an explicit repository and immutable revision, with no token. */
export function hubModelFilesRoot(source: HubModelSource): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
      source.repoId,
    ) ||
    source.repoId.includes("..") ||
    source.repoId.endsWith(".")
  )
    throw new Error("Invalid Hugging Face model repository.");
  if (!/^[a-f0-9]{40}$/.test(source.revision))
    throw new Error("The Hugging Face model must use a pinned revision.");
  return `https://huggingface.co/${source.repoId}/resolve/${source.revision}/`;
}

/** Public pages load their selected export from their own origin. Only local
 * development may use a separate loopback file server. */
export function modelFilesRoot(
  requested: string | undefined,
  origin: string,
): string {
  const page = new URL(origin);
  const files = new URL(requested ?? "/models/", page);
  if (
    !["http:", "https:"].includes(files.protocol) ||
    (files.origin !== page.origin &&
      !(loopback(page.hostname) && loopback(files.hostname)))
  )
    throw new Error("Fine-tuned model files must come from this site.");
  if (
    !files.pathname.endsWith("/") ||
    files.username ||
    files.password ||
    files.search ||
    files.hash
  )
    throw new Error("Invalid model files URL.");
  return files.href;
}
