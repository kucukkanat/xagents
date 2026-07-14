import type { MouseEvent } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

/**
 * Light/dark switch. On supporting browsers the swap plays as a circular
 * clip-path reveal originating from the button (View Transitions API); it falls
 * back to an instant swap under reduced-motion or where the API is absent.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    const next = isDark ? "light" : "dark";
    const doc = document as ViewTransitionDocument;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduced) {
      setTheme(next);
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = doc.startViewTransition(() => setTheme(next));
    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration: 420,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={toggle}
      className="press"
    >
      <SunIcon className="hidden rotate-0 transition-transform duration-300 ease-fluid dark:block" />
      <MoonIcon className="rotate-0 transition-transform duration-300 ease-fluid dark:hidden" />
    </Button>
  );
}
