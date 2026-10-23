import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SECTIONS } from "../sections/registry.ts";
import { useScrollerStore } from "../store/useScrollerStore.ts";
import { Landing } from "./Landing.tsx";

/** Canonical hash path for a chapter, e.g. "/scene-02". */
export function routeForIndex(index: number) {
  const section = SECTIONS[index];
  return section ? `/scene-${section.chapter}` : "/scene-01";
}

function indexForPathname(pathname: string) {
  const match = /^\/?scene-0*(\d+)\/?$/i.exec(pathname);
  if (!match) return null;
  const chapter = match[1].padStart(2, "0");
  const index = SECTIONS.findIndex((section) => section.chapter === chapter);
  return index >= 0 ? index : null;
}

/**
 * Bridges the HashRouter location and the Zustand scroll engine: scrolling
 * writes the active chapter to the URL, while opening or refreshing a
 * "/scene-02" URL snaps the engine to that chapter.
 */
export function StoryRouter() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const index = indexForPathname(location.pathname);

    if (index === null) {
      // "/" keeps the chapter already in the store; bad paths start at 01.
      const fallback =
        location.pathname === "/" || location.pathname === ""
          ? useScrollerStore.getState().activeIndex
          : 0;
      navigate(routeForIndex(fallback), { replace: true });
      return;
    }

    const canonical = routeForIndex(index);
    if (location.pathname !== canonical) {
      navigate(canonical, { replace: true });
    }

    const store = useScrollerStore.getState();
    if (store.activeIndex !== index) {
      store.jumpTo(index);
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    return useScrollerStore.subscribe((state, previous) => {
      if (state.activeIndex === previous.activeIndex) return;
      navigate(routeForIndex(state.activeIndex), { replace: true });
    });
  }, [navigate]);

  return <Landing />;
}
