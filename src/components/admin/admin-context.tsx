"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from "react";
import type { EditorialState } from "@/lib/editorial";
import { Mark } from "@/components/mark";

type Saved = { state: EditorialState; result: Record<string, unknown> };
type Context = { data: EditorialState; busy: boolean; xConnected: boolean; run: (args: Record<string, unknown>, message?: string) => Promise<Saved | null>; notify: (message: string) => void };
const AdminContext = createContext<Context | null>(null);
export function useAdmin() { const context = useContext(AdminContext); if (!context) throw new Error("Admin context missing"); return context; }
export function AdminShell({ initial, xConnected, children }: { initial: EditorialState; xConnected: boolean; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const ref = useRef(initial);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pathname = usePathname();
  async function run(args: Record<string, unknown>, message = "Saved.") {
    if (saving.current) return null;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, revision: ref.current.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save.");
      ref.current = result.state; setData(result.state); setNotice(message);
      return result as Saved;
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  const navigation = [["/admin", "Overview"], ["/admin/weeks", "Weeks"], ["/admin/projects", "Projects"], ["/admin/reviews", "Reviews"], ["/admin/schedule", "Schedule"], ["/admin/x-daily", "X daily"], ["/admin/messages", "Messages"], ["/admin/settings", "Settings"]];
  return <AdminContext.Provider value={{ data, busy, run, notify: setNotice, xConnected }}>
    <div className="desk">
      <header className="desk-header"><Mark /><span className="desk-header-label">Review desk</span><Link href="/" target="_blank">View site ↗</Link><button data-leave-form className="desk-link-button" disabled={busy} onClick={async () => {
        try {
          const response = await fetch("/api/admin/logout", { method: "POST" }); if (!response.ok) throw new Error();
          // Discard all client-cached admin data after revoking the session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }
        catch { setError("Could not sign out. Please try again."); }
      }}>Sign out</button></header>
      <aside className="desk-sidebar">
        <nav aria-label="Admin navigation">{navigation.map(([href, label]) => <Link href={href} key={href} className={pathname === href || href !== "/admin" && pathname.startsWith(href + "/") ? "active" : ""}>{label}</Link>)}</nav>
        <div className="desk-editor"><strong>{data.settings.name}</strong><span>@{data.settings.handle}</span></div>
      </aside>
      <main className="desk-main">{children}</main>
      {(notice || error) && <div className={`desk-notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}><span>{error || notice}</span>{error.toLowerCase().includes("sign in") && <a href="/login" target="_blank" rel="noreferrer">Sign in ↗</a>}<button aria-label="Dismiss notification" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
    </div>
  </AdminContext.Provider>;
}

export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest("a,[data-leave-form]");
      const link = target instanceof HTMLAnchorElement ? target : null;
      const leaving = target?.hasAttribute("data-leave-form") || (link && !link.target && !link.hasAttribute("download") && link.href !== location.href);
      if (leaving && !window.confirm("Leave without saving your changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
}
export async function copyText(text: string, notify: (message: string) => void) {
  try { await navigator.clipboard.writeText(text); notify("Copied to clipboard."); }
  catch { notify("Clipboard unavailable. Select the text and copy it manually."); }
}
