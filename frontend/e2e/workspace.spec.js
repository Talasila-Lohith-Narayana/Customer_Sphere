import { expect, test } from "@playwright/test";

test("signs in and opens the customer workspace", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname.endsWith("/auth/login") && request.method() === "POST") {
      await route.fulfill({
        json: {
          access_token: "e2e-test-token",
          username: "admin",
          role: "admin",
          access_pages: ["dashboard", "customers", "products", "analytics", "campaigns", "model"],
        },
      });
      return;
    }
    if (pathname.endsWith("/auth/profiles")) {
      await route.fulfill({ json: [{ username: "admin", role: "admin" }] });
      return;
    }
    if (pathname.endsWith("/customers")) {
      await route.fulfill({
        json: {
          items: [],
          total: 0,
          page: 1,
          page_size: 12,
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.locator("#login-password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Customers" })).toBeVisible();
  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(page.getByText("No customers found")).toBeVisible();
});
