import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDashboardCache,
  readDashboardCache,
  writeDashboardCache,
} from "./dashboardCache";

describe("dashboardCache", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("clears dashboard entries without removing unrelated session data", () => {
    writeDashboardCache("cache-test-user", "summary", { timeframe: "all" }, { total: 3 });
    sessionStorage.setItem("other-application-data", "keep");

    clearDashboardCache();

    expect(readDashboardCache("cache-test-user", "summary", { timeframe: "all" })).toBeNull();
    expect(sessionStorage.getItem("other-application-data")).toBe("keep");
  });
});
