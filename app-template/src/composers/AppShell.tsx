import type { ReactNode } from "react";

export function AppShell({
  title,
  message,
  persistError,
  children,
}: {
  title?: string;
  message?: string;
  persistError?: string;
  children?: ReactNode;
}) {
  const heading = title || "Ready to build.";
  return (
    <div className={children ? "app" : "shell"}>
      <header>
        <h1 id="app-title">{heading}</h1>
      </header>
      <main aria-labelledby="app-title">
        {message ? (
          <p className="banner" role="status">
            {message}
          </p>
        ) : null}
        {persistError ? (
          <p className="banner" role="status">
            {persistError}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
