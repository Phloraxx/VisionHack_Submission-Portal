import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateOrigin } from "../origin.server";

const ORIG_ALLOWED = process.env.ALLOWED_ORIGINS;
const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_PB_URL = process.env.POCKETBASE_URL;

describe("validateOrigin", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
    process.env.NODE_ENV = "test";
    process.env.POCKETBASE_URL = "http://localhost:8090";
  });

  afterEach(() => {
    process.env.ALLOWED_ORIGINS = ORIG_ALLOWED;
    process.env.NODE_ENV = ORIG_NODE_ENV;
    process.env.POCKETBASE_URL = ORIG_PB_URL;
  });
  // -----------------------------------------------------------------------
  // Valid origins
  // -----------------------------------------------------------------------
  it("accepts localhost:5173", () => {
    const request = new Request("http://localhost:5173/test", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(() => validateOrigin(request)).not.toThrow();
  });

  it("accepts production domain", () => {
    const request = new Request("https://visionhack.mulearn.org/some-path", {
      headers: { Origin: "https://visionhack.mulearn.org" },
    });
    expect(() => validateOrigin(request)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Invalid origins
  // -----------------------------------------------------------------------
  it("rejects an origin not in the allowed list", () => {
    const request = new Request("http://localhost:9999", {
      headers: { Origin: "https://evil.com" },
    });
    try {
      validateOrigin(request);
      expect.fail("Expected validateOrigin to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
  });

  it("allows a request with no Origin header (CSRF cookie is primary defense)", () => {
    const request = new Request("http://localhost:5173/test");
    expect(() => validateOrigin(request)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Custom ALLOWED_ORIGINS from env
  // -----------------------------------------------------------------------
  it("uses env ALLOWED_ORIGINS when set", () => {
    process.env.ALLOWED_ORIGINS = "https://custom.example.com";
    const request = new Request("https://custom.example.com/path", {
      headers: { Origin: "https://custom.example.com" },
    });
    expect(() => validateOrigin(request)).not.toThrow();
  });

  it("rejects origins not in env ALLOWED_ORIGINS", () => {
    process.env.ALLOWED_ORIGINS = "https://only-this.com";
    const request = new Request("https://evil.com/path", {
      headers: { Origin: "https://evil.com" },
    });
    try {
      validateOrigin(request);
      expect.fail("Expected validateOrigin to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
  });
});
