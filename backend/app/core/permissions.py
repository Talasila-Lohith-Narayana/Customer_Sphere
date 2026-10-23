import json

from fastapi import Depends, HTTPException

ACCESS_PAGES = (
    "dashboard",
    "customers",
    "products",
    "analytics",
    "campaigns",
    "model",
    "audit_logs",
)

# Preserve the areas the original read-only viewer account could access.
DEFAULT_VIEWER_ACCESS = ("dashboard", "customers", "products", "audit_logs")


def get_user_access_pages(user):
    if user.role == "admin":
        return list(ACCESS_PAGES)
    if user.access_pages is None:
        return list(DEFAULT_VIEWER_ACCESS)
    try:
        pages = json.loads(user.access_pages)
    except json.JSONDecodeError as exc:
        raise HTTPException(500, "The user's access settings are invalid.") from exc
    if not isinstance(pages, list) or any(page not in ACCESS_PAGES for page in pages):
        raise HTTPException(500, "The user's access settings are invalid.")
    return pages


def require_page(page):
    from app.core.auth import auth

    def check_access(user=Depends(auth)):
        if user["role"] != "admin" and page not in user["access_pages"]:
            raise HTTPException(
                403,
                f"Access to the {page.replace('_', ' ')} area is not permitted.",
            )
        return user

    return check_access


def require_page_access(page):
    return require_any_page_access(page)


def require_any_page_access(*pages):
    from app.core.auth import auth

    def check_access(user=Depends(auth)):
        if user["role"] != "admin" and not any(
            page in user["access_pages"] for page in pages
        ):
            page_labels = " or ".join(page.replace("_", " ") for page in pages)
            raise HTTPException(
                403,
                f"Access to the {page_labels} area is not permitted.",
            )
        return user

    return check_access


def require_products_area_access():
    return require_page_access("products")


def require_customer_analytics_access():
    return require_any_page_access("customers", "model")


def require_clv_delivery_access():
    return require_any_page_access("customers", "analytics")


def require_audit_access():
    return require_page_access("audit_logs")


def require_campaign_data_access():
    return require_any_page_access("campaigns", "analytics")
