import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Landing from "./Landing";
import * as AuthContextModule from "../context/AuthContext";

describe("Landing page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderLanding(isAuthenticated = false) {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      isAuthenticated,
      hasAccess: (page) => ["dashboard", "customers", "products", "assistant"].includes(page),
    });
    return render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
  }

  it("introduces the platform and provides clear sign-in paths", () => {
    renderLanding();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /know customers\.\s*grow with clarity\./i,
    );
    expect(
      screen.getAllByRole("link", { name: /sign in to your workspace/i })[0],
    ).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /^sign in$/i })).toHaveLength(2);
    expect(
      screen.getByRole("img", { name: /team working together/i }),
    ).toBeInTheDocument();
  });

  it("provides platform details and a working section navigation target", () => {
    renderLanding();

    expect(screen.getByRole("link", { name: /discover the platform/i })).toHaveAttribute(
      "href",
      "#platform",
    );
    expect(screen.getByRole("heading", { name: /from information to understanding/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /know your customers/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /nova, your ai assistant/i }))
      .toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /explore in your workspace/i }),
    ).toHaveLength(4);
    expect(screen.getAllByRole("link", { name: /see the whole picture/i })[0])
      .toHaveAttribute("href", "/login");
    expect(screen.getByRole("heading", { name: /find your way from question to action/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#journey",
    );
  });

  it("smooth-scrolls only the requested section when a section link is clicked", () => {
    renderLanding();
    const target = document.getElementById("platform");
    target.scrollIntoView = vi.fn();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    fireEvent.click(screen.getByRole("link", { name: /discover the platform/i }));

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(window.location.hash).toBe("#platform");
    window.matchMedia = originalMatchMedia;
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("reveals sections as they enter the viewport and disconnects on unmount", () => {
    let onIntersection;
    const disconnect = vi.fn();
    const unobserve = vi.fn();
    class MockIntersectionObserver {
      constructor(callback) {
        onIntersection = callback;
      }

      observe = vi.fn();
      unobserve = unobserve;
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { unmount } = renderLanding();
    const target = document.querySelector("[data-scroll-reveal]");
    expect(document.querySelector(".publicHome")).toHaveClass("publicMotionReady");

    act(() => onIntersection([{ isIntersecting: true, target }]));

    expect(target).toHaveClass("publicIsVisible");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("moves the vehicle along the track in proportion to page scroll", async () => {
    const scrollY = vi.spyOn(window, "scrollY", "get").mockReturnValue(500);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);

    renderLanding();

    const home = document.querySelector(".publicHome");
    const vehicle = document.querySelector(".publicScrollVehicle");
    expect(vehicle).toBeInTheDocument();
    await waitFor(() => {
      expect(home.style.getPropertyValue("--public-scroll-progress")).toBe("50.00%");
    });
    const initialCarPosition = parseFloat(
      home.style.getPropertyValue("--public-scroll-car-left"),
    );

    scrollY.mockReturnValue(1000);
    fireEvent.scroll(window);
    await waitFor(() => {
      expect(home.style.getPropertyValue("--public-scroll-progress")).toBe("100.00%");
    });
    expect(
      parseFloat(home.style.getPropertyValue("--public-scroll-car-left")),
    ).toBeGreaterThan(initialCarPosition);
  });

  it("only reveals the scrollbar while the pointer is over the right gutter", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(990);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(900);

    renderLanding();

    fireEvent.pointerMove(window, { clientX: 999 });
    expect(document.documentElement).toHaveClass("publicScrollbarHover");

    fireEvent.pointerMove(window, { clientX: 500 });
    expect(document.documentElement).not.toHaveClass("publicScrollbarHover");
  });

  it("keeps the home page available and links signed-in users to their workspace", () => {
    renderLanding(true);

    expect(screen.getAllByRole("link", { name: /go to workspace/i })).toHaveLength(5);
    expect(screen.getAllByRole("link", { name: /go to workspace/i })[0])
      .toHaveAttribute("href", "/dashboard");
    expect(screen.getAllByRole("link", { name: /explore in your workspace/i })[0])
      .toHaveAttribute("href", "/customers");
    expect(screen.getAllByRole("link", { name: /see the whole picture/i })[0])
      .toHaveAttribute("href", "/dashboard");
  });
});
