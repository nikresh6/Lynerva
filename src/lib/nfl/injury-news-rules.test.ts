import { describe, expect, it } from "vitest";
import { attributedInjurySnippet } from "./injury-news-rules";

describe("injury news attribution", () => {
  it("does not assign a teammate injury to a healthy player mentioned nearby", () => {
    const article =
      "Kyren Williams and Blake Corum headline the Rams backfield. Puka Nacua is inactive with a groin injury.";
    expect(attributedInjurySnippet(article, "Kyren Williams")).toBeNull();
  });

  it("matches injury language tied to the named player", () => {
    const article =
      "Puka Nacua is inactive for Week 2 because of a groin injury. Davante Adams is expected to lead the receivers.";
    expect(attributedInjurySnippet(article, "Puka Nacua")).toContain(
      "Puka Nacua",
    );
  });

  it("does not use a last-name-only collision", () => {
    const article =
      "Mike Williams is questionable with an ankle injury. Kyren Williams is expected to handle his normal workload.";
    expect(attributedInjurySnippet(article, "Kyren Williams")).toBeNull();
  });

  it("supports compact status-card wording", () => {
    const card = "Puka Nacua - OUT - Groin";
    expect(attributedInjurySnippet(card, "Puka Nacua")).toBe(card);
  });
});
