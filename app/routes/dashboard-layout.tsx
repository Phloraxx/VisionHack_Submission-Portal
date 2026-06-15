import { useState } from "react";
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
import { Button } from "~/components/ui/button";
import { LoadingSpinner } from "~/components/shared/loading-spinner";
import { Skeleton } from "~/components/ui/skeleton";
import { PageTransition } from "~/components/shared/page-transition";
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
} from "lucide-react";

// Role-based navigation items
const navItems: Record<Role, Array<{ label: string; href: string; icon: React.ComponentType<{ className?: string }> }>> = {
  admin: [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Campus Leads", href: "/admin/campus-leads", icon: University },
    { label: "Config", href: "/admin/config", icon: Settings },
    { label: "Teams", href: "/admin/teams", icon: Users },
    { label: "Export", href: "/admin/export", icon: Download },
  ],
  coordinator: [
    { label: "Dashboard", href: "/coordinator/dashboard", icon: LayoutDashboard },
    { label: "Teams", href: "/coordinator/dashboard", icon: Users },
  ],
  institution: [
    { label: "Dashboard", href: "/institution/dashboard", icon: LayoutDashboard },
  ],
  lead: [
    { label: "Dashboard", href: "/lead/dashboard", icon: LayoutDashboard },
    { label: "Register Team", href: "/lead/register", icon: UserPlus },
    { label: "Questionnaire", href: "/lead/questionnaire", icon: ClipboardList },
    { label: "Submit Idea", href: "/lead/submit-idea", icon: FileUp },
  ],
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, token } = await requireAuth(request);

  // If the token was refreshed by authRefresh(), re-issue the cookie
  const originalToken = getAuthFromCookie(request);
  const headers = new Headers();
  if (token && token !== originalToken) {
    headers.append("Set-Cookie", setAuthCookie(token));
  }

  return data({ user }, { headers });
}

export default function DashboardLayout() {
  const { user } = useLoaderData() as { user: UserRecord };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const items = navItems[user.role] ?? [];

  return (
    <div className="flex h-screen overflow-hidden bg-muted/20">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed position, full height, scrolls independently */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-sidebar-foreground"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-primary-foreground">
              VH
            </div>
            <span>VisionHack</span>
          </Link>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            {user.role === "admin"
              ? "Admin"
              : user.role === "coordinator"
                ? "Coordinator"
                : user.role === "institution"
                  ? "Institution"
                  : "Team Lead"}
          </p>
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                    {isActive && (
                      <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User info + logout */}
        <div className="border-t p-3">
          <div className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
              {user.name
                ?.split(" ")
                .map((n: string) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2) ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {user.name}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/50">
                {user.email}
              </p>
            </div>
          </div>
          <Form method="post" action="/api/auth/logout">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </Form>
        </div>
      </aside>

      {/* Main content — scrollable, offset for fixed sidebar */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Top header (mobile) */}
        <header className="flex h-14 items-center gap-3 border-b bg-background px-4 lg:hidden">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[9px] font-bold text-primary-foreground">
              VH
            </div>
            <span>VisionHack</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {/* Thin loading bar for client-side navigations */}
          <div
            className={`fixed inset-x-0 top-0 z-50 h-0.5 bg-primary transition-opacity duration-300 ${
              isNavigating ? "opacity-100" : "opacity-0"
            }`}
          >
            {isNavigating && (
              <div className="h-full w-full animate-[loading-bar_1.5s_ease-in-out_infinite] bg-primary-foreground/30" />
            )}
          </div>
          <PageTransition>
          <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HydrateFallback — shown while the layout is hydrating on the client
// ---------------------------------------------------------------------------

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Skeleton sidebar — mirrors the real sidebar structure */}
      <aside className="flex w-64 flex-col border-r bg-sidebar">
        {/* Logo area */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-4 w-20" />
        </div>
        {/* Nav items */}
        <nav className="flex-1 space-y-1 p-3">
          <Skeleton className="mb-2 h-3 w-12" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </nav>
        {/* User pill */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="mt-2 h-9 w-full rounded-lg" />
        </div>
      </aside>

      {/* Content area — child routes provide their own HydrateFallback */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center border-b bg-background px-4">
          <Skeleton className="h-4 w-24" />
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary — catches errors in layout and child routes
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
  } else if (error instanceof Error) {
    details = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-8">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 text-5xl font-bold text-muted-foreground/20">
          {isRouteErrorResponse(error) ? error.status : "!"}
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          {message}
        </h1>
        <p className="mb-8 text-muted-foreground">{details}</p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}
