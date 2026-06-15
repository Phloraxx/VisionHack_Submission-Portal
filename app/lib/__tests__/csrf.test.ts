import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { validateOrigin } from "../csrf.server";
import { resetEnv } from "../env.server";

const DEFAULT_ALLOWED = "http://localhost:5173,http://localhost:3000,https://visionhack.mulearn.org";

describe("validateOrigin", () => {
  const originalEnv = process.env.ALLOWED_ORIGINS;

  beforeAll(() => {
    // Ensure we're testing against the default origins
    delete process.env.ALLOWED_ORIGINS;
  });

  beforeEach(() => {
    // Clear cached env so getEnv() re-reads from process.env
    resetEnv();
  });

  afterAll(() => {
    process.env.ALLOWED_ORIGINS = originalEnv;
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

  it("rejects a request with no Origin header", () => {
    const request = new Request("http://localhost:5173/test");
    try {
      validateOrigin(request);
      expect.fail("Expected validateOrigin to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
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
