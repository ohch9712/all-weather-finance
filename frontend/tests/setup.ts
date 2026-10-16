import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { memoryRouter, server } from "./utils";

// next/navigation을 메모리 라우터로 바꾼다. push/replace는 vi.fn이고 usePathname·useSearchParams가 따라 바뀐다.
// 테스트는 tests/utils.tsx의 memoryRouter(또는 renderWithProviders가 돌려주는 router)로 이동을 확인한다.
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const listeners = new Set<() => void>();
  let current = new URL("http://localhost/");

  function setLocation(href: string) {
    current = new URL(href, current);
    // window.location도 맞춰 둔다(브라우저와 같게).
    window.history.replaceState(null, "", `${current.pathname}${current.search}`);
    listeners.forEach((listener) => listener());
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const router = {
    push: vi.fn((href: string) => setLocation(href)),
    replace: vi.fn((href: string) => setLocation(href)),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };

  const memory = {
    router,
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    reset(href = "/") {
      Object.values(router).forEach((fn) => fn.mockClear());
      setLocation(new URL(href, "http://localhost/").toString());
    },
  };

  return {
    useRouter: () => router,
    usePathname: () => React.useSyncExternalStore(subscribe, () => current.pathname, () => current.pathname),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, () => current.search, () => current.search);
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
    useParams: () => ({}),
    redirect: vi.fn(),
    notFound: vi.fn(),
    __memoryRouter: memory,
  };
});

// jsdom에 없는 브라우저 API(Radix·Recharts·sonner가 쓴다)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};

// 처리하지 않은 요청은 실패로 본다. 테스트가 실제 백엔드·외부 API를 부르지 않게 한다.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  memoryRouter.reset("/");
});
afterAll(() => server.close());
