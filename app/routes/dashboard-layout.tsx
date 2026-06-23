import { useState, useEffect, useRef } from "react";
import {
  Outlet,
  Form,
  useLoaderData,
  Link,
  useLocation,
  isRouteErrorResponse,
  useRouteError,
  useNavigation,
  data,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth, getAuthFromCookie, setAuthCookie } from "~/lib/auth.server";
import type { UserRecord, Role } from "~/lib/types";
import { Skeleton } from "~/components/ui/skeleton";
import { PageTransition } from "~/components/shared/page-transition";
import { EventMark } from "~/components/shared/event-mark";
import {
  LayoutDashboard,
  University,
  Settings,
  Users,
  Download,
  UserPlus,
  ClipboardList,
  FileUp,
  Menu,
  X,
  LogOut,
  ChevronRight,
  RefreshCw,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "~/lib/utils";

const navItems: Record<
  Role,
  Array<{
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    description?: string;
  }>
> = {
  admin: [
    { label: "Overview", href: "/admin/dashboard", icon: LayoutDashboard, description: "Event pulse" },
    { label: "Teams", href: "/admin/teams", icon: Users, description: "Pipeline" },
    { label: "Campus Leads", href: "/admin/campus-leads", icon: University, description: "Institutions" },
    { label: "Config", href: "/admin/config", icon: Settings, description: "Event phases" },
    { label: "Export", href: "/admin/export", icon: Download, description: "CSV download" },
  ],
  coordinator: [
    { label: "Overview", href: "/coordinator/dashboard", icon: LayoutDashboard, description: "Pipeline" },
  ],
  institution: [
    { label: "Dashboard", href: "/institution/dashboard", icon: LayoutDashboard, description: "Campus teams" },
  ],
  lead: [
    { label: "Dashboard", href: "/lead/dashboard", icon: LayoutDashboard, description: "Status" },
    { label: "Register Team", href: "/lead/register", icon: UserPlus, description: "Members" },
    { label: "Questionnaire", href: "/lead/questionnaire", icon: ClipboardList, description: "Profile" },
    { label: "Submit Idea", href: "/lead/submit-idea", icon: FileUp, description: "Presentation" },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  coordinator: "Coordinator",
  institution: "Campus Lead",
  lead: "Team Lead",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, token } = await requireAuth(request);

  const originalToken = getAuthFromCookie(request);
  const headers = new Headers();
  if (token && token !== originalToken) {
    headers.append("Set-Cookie", setAuthCookie(token));
  }

  return data({ user }, { headers });
}

/**
 * (theme script lives in app/root.tsx so it can be nonce-stamped once.
 *  Do not duplicate it here — every navigation would re-render it.)
 */

/**
 * Theme toggle. The initial theme is applied by the inline script in
 * app/root.tsx so SSR matches the client without a flash; this hook
 * only reads the current class to keep React state in sync and writes
 * the new choice back to localStorage.
 */
function useTheme() {
  // Always start as "light" so SSR and the first client render match.
  // The real theme was applied by the inline script in app/root.tsx
  // before paint; we sync the React state to that class in an effect so
  // the toggle button reflects the active theme without a hydration
  // mismatch.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("vh-theme", next);
    } catch {
      // localStorage unavailable — the dark class is enough for this tab
    }
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return { theme, toggle };
}

export default function DashboardLayout() {

  const { user } = useLoaderData() as { user: UserRecord; csrfToken: string };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const items = navItems[user.role] ?? [];
  const { theme, toggle } = useTheme();

  // Drawer behavior: Escape-to-close, body scroll lock, focus return.
  // Capture the element that opened the drawer so focus can come back
  // to it when the user closes the drawer.
  const openTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSidebarOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to the trigger that opened the drawer.
      openTriggerRef.current?.focus();
    };
  }, [sidebarOpen]);

  const openSidebar = (e: React.MouseEvent<HTMLElement>) => {
    openTriggerRef.current = e.currentTarget;
    setSidebarOpen(true);
  };

  return (
    <div className="flex vh-h-screen-dynamic overflow-hidden bg-background text-foreground">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden vh-safe-top"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Skip-to-main link — visible on keyboard focus only.
          Targets #primary-content on the main landmark. */}
      <a
        href="#primary-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* -------------------------------------------------------------
          SIDEBAR — dark chrome, event identity top, role badge, nav
          ------------------------------------------------------------- */}
      <aside
        id="primary-sidebar"
        aria-label="Primary"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground drawer-slide lg:w-64 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand header — centered event logo */}
        <div className="relative flex h-16 items-center justify-center border-b border-sidebar-border px-4 vh-safe-top">
          <Link
            to="/"
            className="inline-flex items-center justify-center"
            aria-label="VisionHack home"
          >
            <img src="/logo.svg" alt="μLearn SCET · VisionHack 2026" className="h-16 w-auto max-w-[90%]" />
          </Link>
          <button
            type="button"
            className="vh-touch absolute right-4 flex h-10 w-10 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Role context */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/50">
              Logged in as
            </p>
            <button
              type="button"
              onClick={toggle}
              className="vh-touch flex h-8 w-8 items-center justify-center rounded-sm text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-sm font-medium text-sidebar-foreground">
            {ROLE_LABEL[user.role as Role] ?? "Unknown role"}
          </p>
          <p className="text-xs text-sidebar-foreground/60 truncate">
            {user.email}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.href ||
                (item.href !== "/" &&
                  location.pathname.startsWith(item.href + "/"));
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive
                          ? "text-primary"
                          : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {isActive && (
                      <ChevronRight className="h-3 w-3 text-primary" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer — sign out */}
        <div className="border-t border-sidebar-border p-3">
          <Form method="post" action="/api/auth/logout">
            <button
              type="submit"
              className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </Form>
        </div>
      </aside>

      {/* -------------------------------------------------------------
          MAIN
          ------------------------------------------------------------- */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Top bar — mobile only (sidebar header already shows brand) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden vh-safe-top">
          <button
            type="button"
            className="vh-touch flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={openSidebar}
            aria-label="Open sidebar"
            aria-expanded={sidebarOpen}
            aria-controls="primary-sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src="/logo-white.svg" alt="VisionHack" className="h-6 w-auto" />
        </header>

        {/* Loading bar */}
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-50 h-0.5 bg-primary/15 transition-opacity duration-300 lg:left-64",
            isNavigating ? "opacity-100" : "opacity-0",
          )}
          aria-hidden="true"
        >
          <div className="loading-bar-fill h-full w-1/3 bg-primary" />
        </div>

        <main
          id="primary-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          <div
            className={cn(
              "mx-auto w-full max-w-7xl px-4 py-6 sm:px-5 sm:py-8 md:px-8 md:py-10 transition-opacity duration-300 ease-out",
              isNavigating ? "opacity-60" : "opacity-100",
            )}>
              <PageTransition key={location.pathname}>
                <Outlet />
              </PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HydrateFallback — skeleton matching real structure
// ---------------------------------------------------------------------------

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
          <Skeleton className="h-8 w-8 rounded-md bg-sidebar-accent" />
          <Skeleton className="h-4 w-24 bg-sidebar-accent" />
        </div>
        <div className="border-b border-sidebar-border p-4 space-y-2">
          <Skeleton className="h-3 w-20 bg-sidebar-accent" />
          <Skeleton className="h-4 w-32 bg-sidebar-accent" />
          <Skeleton className="h-3 w-40 bg-sidebar-accent" />
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md bg-sidebar-accent" />
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "Something went wrong";
  let details = "An unexpected error occurred while loading this page.";

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `${error.status} ${error.statusText}`;
    details =
      error.status === 404
        ? "The page you are looking for does not exist or you may not have access."
        : error.data?.message || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="mx-auto max-w-md text-center">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
          Error {isRouteErrorResponse(error) ? error.status : ""}
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">{message}</h1>
        <p className="mb-8 text-sm text-muted-foreground">{details}</p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
