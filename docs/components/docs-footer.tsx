import { FOOTER_LINKS } from "@/lib/layout.shared";

export function DocsFooter() {
  return (
    <footer className="mt-16 border-t border-fd-border pt-6 text-sm text-fd-muted-foreground flex items-center justify-between gap-4">
      <span>© {new Date().getFullYear()} FlowBack</span>
      <div className="flex items-center gap-4">
        <a
          href={FOOTER_LINKS.github}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="FlowBack on GitHub"
          className="hover:text-fd-foreground transition"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="size-5"
          >
            <path d="M12 2C6.477 2 2 6.596 2 12.267c0 4.537 2.865 8.387 6.839 9.746.5.095.682-.223.682-.495 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.37-3.369-1.37-.455-1.186-1.11-1.502-1.11-1.502-.908-.637.069-.624.069-.624 1.004.073 1.532 1.056 1.532 1.056.892 1.567 2.341 1.114 2.91.852.091-.664.35-1.114.636-1.37-2.22-.259-4.555-1.14-4.555-5.073 0-1.12.39-2.036 1.029-2.754-.103-.26-.446-1.304.098-2.719 0 0 .84-.276 2.75 1.052A9.292 9.292 0 0 1 12 6.844a9.27 9.27 0 0 1 2.504.349c1.909-1.328 2.748-1.052 2.748-1.052.546 1.415.203 2.459.1 2.719.64.718 1.028 1.634 1.028 2.754 0 3.943-2.339 4.811-4.566 5.065.359.319.678.947.678 1.909 0 1.378-.012 2.489-.012 2.829 0 .274.18.594.688.493C19.138 20.65 22 16.802 22 12.267 22 6.596 17.523 2 12 2Z" />
          </svg>
        </a>
        <a
          href={FOOTER_LINKS.x}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="FlowBack on X"
          className="hover:text-fd-foreground transition"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="size-4"
          >
            <path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.945l-4.62-6.04L5.4 22H2.642l7-8L2 2h7.115l4.18 5.52L18.244 2Zm-2.434 18h1.93L8.31 4H6.235L15.81 20Z" />
          </svg>
        </a>
      </div>
    </footer>
  );
}
