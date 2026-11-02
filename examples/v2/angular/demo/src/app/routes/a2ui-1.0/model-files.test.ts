import { describe, expect, it } from "vitest";
import { modelFilesRoot, hubModelFilesRoot } from "./model-files";

describe("hosted model files", () => {
  it("defaults to the Firebase site's own origin", () => {
    expect(modelFilesRoot(undefined, "https://express-demo.web.app")).toBe(
      "https://express-demo.web.app/models/",
    );
  });
  it("retains the explicitly separate file server for local development", () => {
    expect(
      modelFilesRoot("http://127.0.0.1:8899/models/", "http://localhost:4210"),
    ).toBe("http://127.0.0.1:8899/models/");
  });
  it.each([
    "http://127.0.0.1:8899/models/",
    "https://another-site.example/models/",
    "file:///models/",
  ])("rejects a public site's model request to %s", (address) => {
    expect(() =>
      modelFilesRoot(address, "https://express-demo.web.app"),
    ).toThrow();
  });
});

describe("Hugging Face model files", () => {
  const revision = "a".repeat(40);
  it("resolves the configured repository at its immutable revision", () => {
    expect(
      hubModelFilesRoot({ repoId: "demo-owner/gemma-4-e2b-express", revision }),
    ).toBe(
      `https://huggingface.co/demo-owner/gemma-4-e2b-express/resolve/${revision}/`,
    );
  });
  it.each(["main", "release-v1", ""])(
    "rejects the moving or missing revision %s",
    (revision) => {
      expect(() =>
        hubModelFilesRoot({
          repoId: "demo-owner/gemma-4-e2b-express",
          revision,
        }),
      ).toThrow("pinned revision");
    },
  );
  it.each([
    "https://another-site.example/model",
    "owner/../model",
    "owner/model?token=secret",
  ])("rejects the malformed repository %s", (repoId) => {
    expect(() => hubModelFilesRoot({ repoId, revision })).toThrow("repository");
  });
});
