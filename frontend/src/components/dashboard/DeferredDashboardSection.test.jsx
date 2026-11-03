import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DeferredDashboardSection from "./DeferredDashboardSection";
import {
  clearDashboardCache,
  readDashboardCache,
  writeDashboardCache,
} from "../../services/dashboardCache";

describe("DeferredDashboardSection", () => {
  beforeEach(() => {
    clearDashboardCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes an already loaded section when the polling token changes", async () => {
    const loadSection = vi
      .fn()
      .mockResolvedValueOnce({ value: "initial" })
      .mockResolvedValueOnce({ value: "updated" });
    const { rerender } = render(
      <DeferredDashboardSection
        section="geography"
        title="Geographic analytics"
        loadSection={loadSection}
        refreshToken={0}
      >
        {(data) => <p>{data.value}</p>}
      </DeferredDashboardSection>,
    );

    await waitFor(() => expect(screen.getByText("initial")).toBeInTheDocument());
    expect(loadSection).toHaveBeenCalledTimes(1);

    rerender(
      <DeferredDashboardSection
        section="geography"
        title="Geographic analytics"
        loadSection={loadSection}
        refreshToken={1}
      >
        {(data) => <p>{data.value}</p>}
      </DeferredDashboardSection>,
    );

    await waitFor(() => expect(screen.getByText("updated")).toBeInTheDocument());
    expect(loadSection).toHaveBeenCalledTimes(2);
  });

  it("renders cached section data immediately and refreshes the cache", async () => {
    class VisibleIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
    const cacheParams = { timeframe: "all" };
    const cachedData = { value: "Previously loaded trends" };
    const freshData = { value: "Updated trends" };
    writeDashboardCache("test-user", "section:trends", cacheParams, cachedData);
    const loadSection = vi.fn().mockResolvedValue(freshData);

    render(
      <DeferredDashboardSection
        section="trends"
        title="Trends"
        loadSection={loadSection}
        refreshToken={0}
        cacheUser="test-user"
        cacheParams={cacheParams}
      >
        {(data) => <p>{data.value}</p>}
      </DeferredDashboardSection>
    );

    expect(screen.getByText("Previously loaded trends")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Updated trends")).toBeInTheDocument());
    expect(loadSection).toHaveBeenCalledWith("trends");
    expect(readDashboardCache("test-user", "section:trends", cacheParams)).toEqual(freshData);
  });
});
