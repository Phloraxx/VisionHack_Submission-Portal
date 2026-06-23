import { describe, it, expect, vi, beforeEach } from "vitest";
import { data } from "react-router";
import { z } from "zod";
import type { UserRecord } from "../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/lib/auth.server", () => ({
  requireRole: vi.fn(),
}));

vi.mock("~/lib/csrf.server", () => ({
  validateOrigin: vi.fn(),
  validateCsrfToken: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import { requireRole } from "~/lib/auth.server";
import { validateOrigin, validateCsrfToken } from "~/lib/csrf.server";
import { captureException } from "@sentry/node";
import { secureAction } from "../action.server";

const mockRequireRole = vi.mocked(requireRole);
const mockValidateOrigin = vi.mocked(validateOrigin);
const mockValidateCsrfToken = vi.mocked(validateCsrfToken);
const mockCaptureException = vi.mocked(captureException);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * react-router's `data()` returns a `DataWithResponseInit` (not a Response).
 * Narrow structurally to extract status + body.
 */
function extractStatusBody(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "init" in result &&
    "data" in result
  ) {
    const { init, data: payload } = result;
    const status =
      init &&
      typeof init === "object" &&
      "status" in init
        ? Number(init.status)
        : undefined;
    const body =
      payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : undefined;
    return { status, body };
  }
  return { status: undefined, body: undefined };
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    collectionId: "users",
    collectionName: "users",
    username: "testuser",
    verified: true,
    email: "test@example.com",
    role: "admin",
    created: "2024-01-01 00:00:00",
    updated: "2024-01-01 00:00:00",
    ...overrides,
  } as UserRecord;
}

function makeAuthResult(userOverrides: Partial<UserRecord> = {}) {
  const user = makeUser(userOverrides);
  return { user, pb: { collection: vi.fn() } as never, token: "jwt-token" };
}

function makeRequest(
  url = "http://localhost:5173/admin/test",
  body?: URLSearchParams,
) {
  const init: RequestInit = {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) {
    init.body = body.toString();
  }
  return new Request(url, init);
}

function makeArgs(
  request: Request,
  params: Record<string, string> = {},
) {
  return { request, params, context: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("secureAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateOrigin.mockImplementation(() => {});
    mockValidateCsrfToken.mockImplementation(() => {});
  });

  // -----------------------------------------------------------------------
  // Security checks — validateOrigin
  // -----------------------------------------------------------------------

  it("calls validateOrigin with the request", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/test", new URLSearchParams("intent=foo"));
    await action(makeArgs(req));

    expect(mockValidateOrigin).toHaveBeenCalledWith(req);
  });

  it("returns 403 when origin validation fails", async () => {
    mockValidateOrigin.mockImplementation(() => {
      throw new Response(null, { status: 403 });
    });
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest();
    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(403);
    expect(body?.error).toBe("Invalid request origin");
  });

  // -----------------------------------------------------------------------
  // Security checks — validateCsrfToken
  // -----------------------------------------------------------------------

  it("calls validateCsrfToken with request and formData", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/test", new URLSearchParams("intent=foo"));
    await action(makeArgs(req));

    expect(mockValidateCsrfToken).toHaveBeenCalledTimes(1);
    expect(mockValidateCsrfToken).toHaveBeenCalledWith(
      req,
      expect.any(FormData),
    );
  });

  it("returns 403 when CSRF token validation fails", async () => {
    mockValidateCsrfToken.mockImplementation(() => {
      throw new Response(null, { status: 403 });
    });
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/test", new URLSearchParams("intent=foo"));
    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(403);
    expect(body?.error).toBe("Invalid CSRF token");
  });

  // -----------------------------------------------------------------------
  // requireRole
  // -----------------------------------------------------------------------

  it("calls requireRole with the correct roles", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin", "coordinator"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/test", new URLSearchParams("intent=foo"));
    await action(makeArgs(req));

    expect(mockRequireRole).toHaveBeenCalledWith(req, ["admin", "coordinator"]);
  });

  it("calls handler with auth context on success", async () => {
    const authResult = makeAuthResult();
    mockRequireRole.mockResolvedValue(authResult);

    const handler = vi.fn().mockResolvedValue(data({ ok: true }, { status: 200 }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/test", new URLSearchParams("intent=foo"));
    const result = await action(makeArgs(req));

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.user).toBe(authResult.user);
    expect(ctx.pb).toBe(authResult.pb);
    expect(ctx.formData).toBeInstanceOf(FormData);
    expect(ctx.request).toBe(req);
    const { status } = extractStatusBody(result);
    expect(status).toBe(200);
  });

  it("passes route params into context", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest("http://localhost:5173/admin/teams/team-42");
    await action(makeArgs(req, { teamId: "team-42" }));

    const ctx = handler.mock.calls[0][0];
    expect(ctx.params).toEqual({ teamId: "team-42" });
  });

  // -----------------------------------------------------------------------
  // 401 / 403 from requireRole
  // -----------------------------------------------------------------------

  it("returns 401 JSON when not authenticated", async () => {
    mockRequireRole.mockRejectedValue(
      new Response(null, { status: 401, statusText: "Unauthorized" }),
    );
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest();
    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(401);
    expect(body?.error).toBe("Authentication required");
  });

  it("returns 403 JSON when role is insufficient", async () => {
    mockRequireRole.mockRejectedValue(
      new Response(null, { status: 403, statusText: "Forbidden" }),
    );
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest();
    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(403);
    expect(body?.error).toBe("Insufficient permissions");
  });

  it("re-throws non-Response errors from requireRole", async () => {
    mockRequireRole.mockRejectedValue(new Error("PocketBase down"));
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest();
    await expect(action(makeArgs(req))).rejects.toThrow("PocketBase down");
    expect(handler).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Invalid form data
  // -----------------------------------------------------------------------

  it("returns 400 when form data cannot be parsed", async () => {
    const req = new Request("http://localhost:5173/admin/test", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array([0xff, 0xfe]),
    });
    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"] }, handler);

    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(400);
    expect(body?.error).toBe("Invalid form data");
  });

  // -----------------------------------------------------------------------
  // Schema validation
  // -----------------------------------------------------------------------

  it("returns fieldErrors when schema validation fails", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const schema = z.object({ name: z.string().min(1) });

    const handler = vi.fn();
    const action = secureAction({ roles: ["admin"], schema }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams("intent=create&name="),
    );
    const result = await action(makeArgs(req));

    expect(handler).not.toHaveBeenCalled();
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(400);
    expect(body?.fieldErrors).toBeDefined();
  });

  it("passes validated data into context when schema succeeds", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const schema = z.object({ name: z.string().min(1) });

    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"], schema }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams("intent=create&name=hello"),
    );
    await action(makeArgs(req));

    const ctx = handler.mock.calls[0][0];
    expect(ctx.validated).toEqual({ name: "hello" });
  });

  // -----------------------------------------------------------------------
  // Intent normalization
  // -----------------------------------------------------------------------

  it("lowercases the intent field", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams("intent=CREATE_TEAM"),
    );
    await action(makeArgs(req));

    expect(handler.mock.calls[0][0].intent).toBe("create_team");
  });

  it("defaults intent to empty string when missing", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockResolvedValue(data({ ok: true }));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams(),
    );
    await action(makeArgs(req));

    expect(handler.mock.calls[0][0].intent).toBe("");
  });

  // -----------------------------------------------------------------------
  // Handler errors
  // -----------------------------------------------------------------------

  it("returns 500 when handler throws", async () => {
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockRejectedValue(new Error("DB connection lost"));
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams("intent=foo"),
    );
    const result = await action(makeArgs(req));
    const { status, body } = extractStatusBody(result);
    expect(status).toBe(500);
    expect(body?.error).toBe("Something went wrong. Please try again.");
  });

  it("calls Sentry.captureException on handler errors", async () => {
    const handlerError = new Error("database connection lost");
    mockRequireRole.mockResolvedValue(makeAuthResult());
    const handler = vi.fn().mockRejectedValue(handlerError);
    const action = secureAction({ roles: ["admin"] }, handler);

    const req = makeRequest(
      "http://localhost:5173/admin/test",
      new URLSearchParams("intent=delete"),
    );
    await action(makeArgs(req));

    expect(mockCaptureException).toHaveBeenCalledWith(handlerError, {
      extra: expect.objectContaining({
        route: "/admin/test",
        userId: "user-1",
        role: "admin",
        intent: "delete",
      }),
    });
  });
});
