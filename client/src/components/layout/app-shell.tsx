import { useState, type ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";

/**
 * Standard page chrome: the left Sidebar + a content area that shifts with the
 * collapse state. Pages that use this must NOT also render their own Sidebar.
 * (Most existing pages self-wrap; new pages should prefer this so they can't
 * ship without navigation — the bug that stranded /opportunities and
 * /repricing full-width with no way back.)
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className={`transition-all duration-200 ${collapsed ? "ml-16" : "ml-64"}`}>
        {children}
      </div>
    </div>
  );
}
