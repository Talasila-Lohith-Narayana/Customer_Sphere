import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Landing from "./Landing";

describe("Landing page", () => {
  it("introduces the platform and provides clear sign-in paths", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /know customers\.\s*grow with clarity\./i,
    );
    expect(
      screen.getByRole("link", { name: /sign in to your workspace/i }),
    ).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /^sign in$/i })).toHaveLength(2);
    expect(document.documentElement).toHaveClass("publicSmoothScroll");
    expect(
      screen.getByRole("img", { name: /team working together/i }),
    ).toBeInTheDocument();
  });

  it("removes landing-page scroll behavior when leaving the page", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(document.documentElement).toHaveClass("publicSmoothScroll");
    unmount();
    expect(document.documentElement).not.toHaveClass("publicSmoothScroll");
  });

  it("provides platform details and a working section navigation target", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

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
    expect(screen.getByRole("heading", { name: /find your way from question to action/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#journey",
    );
  });
});
