import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ArrowLeftRight, Home } from "lucide-react";

const GITHUB_URL = "https://github.com/flowbackdotfun/flowback";
const X_URL = "https://x.com/flowbackdotfun";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5">
      <circle
        cx="12"
        cy="12"
        r="10.5"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <path
        d="M12 3a9 9 0 1 0 9 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3" fill="var(--color-fd-primary)" />
    </svg>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span>
            FlowBack <span className="text-fd-muted-foreground">/ docs</span>
          </span>
        </span>
      ),
      url: "/",
    },
    githubUrl: GITHUB_URL,
    links: [
      {
        type: "main",
        text: "App",
        url: APP_URL,
        icon: <Home className="size-4" />,
        active: "url",
        external: true,
      },
      {
        type: "main",
        text: "Swap",
        url: `${APP_URL}/swap`,
        icon: <ArrowLeftRight className="size-4" />,
        active: "url",
        external: true,
      },
      {
        type: "icon",
        text: "X",
        label: "FlowBack on X",
        url: X_URL,
        external: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.945l-4.62-6.04L5.4 22H2.642l7-8L2 2h7.115l4.18 5.52L18.244 2Zm-2.434 18h1.93L8.31 4H6.235L15.81 20Z" />
          </svg>
        ),
      },
    ],
  };
}

export const FOOTER_LINKS = { github: GITHUB_URL, x: X_URL };
