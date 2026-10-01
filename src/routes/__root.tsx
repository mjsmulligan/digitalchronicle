import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Map as MapIcon, Luggage, Inbox, HardDrive, Lock, Sparkles, Library } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { initJournal, useJournal } from "@/lib/journal/db";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">This page isn't in your journal.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Back to journal
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Your data is safe in this browser.</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Journal — a private chronicle of your life" },
      { name: "description", content: "A private, local-only personal journal for life events, concerts, milestones, trips and daily reflections." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Chronicle", icon: BookOpen },
  { to: "/trips", label: "Trips", icon: Luggage },
  { to: "/events", label: "Events", icon: Sparkles },
  { to: "/culture", label: "Culture", icon: Library },
  { to: "/places", label: "Places", icon: MapIcon },
  { to: "/import", label: "Import", icon: Inbox },
  { to: "/backup", label: "Backup", icon: HardDrive },
] as const;

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [initError, setInitError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void initJournal().catch((error: unknown) => {
      if (active) setInitError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, []);
  const { staging } = useJournal();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen md:flex">
        <aside className="border-b border-border bg-sidebar md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
          <div className="px-5 py-5">
            <Link to="/" className="font-serif text-2xl font-semibold tracking-tight">Journal</Link>
            <p className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Lock className="h-3 w-3" /> stored only in this browser
            </p>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
                activeProps={{ className: "bg-sidebar-accent font-medium text-sidebar-foreground" }}
              >
                <Icon className="h-4 w-4" /> {label}
                {to === "/import" && staging.length > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">{staging.length}</span>
                )}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-10">
          {initError ? (
            <div role="alert">
              <p>Could not load the journal or offline station lookup: {initError}</p>
              <Button onClick={() => {
                setInitError(null);
                void initJournal().catch((error: unknown) => setInitError(error instanceof Error ? error.message : String(error)));
              }}>Try again</Button>
            </div>
          ) : <Outlet />}
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
