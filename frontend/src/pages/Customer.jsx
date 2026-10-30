import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  History,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  Repeat2,
  ShoppingBag,
  Star,
  Trash2,
  TrendingUp,
  WalletCards,
  BrainCircuit,
  RefreshCw,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { customerService, predictionService } from "../services/api";
import { publishDashboardDataChanged } from "../services/dashboardDataEvents";
import { useToast } from "../context/ToastContext";
import InteractionModal from "../components/InteractionModal";
import OrderModal from "../components/OrderModal";
import ReviewModal from "../components/ReviewModal";
import CustomerModal from "../components/CustomerModal";
import ConfirmModal from "../components/ConfirmModal";
import { ErrorState, LoadingState, Page } from "../components/States";
import { useAuth } from "../context/AuthContext";

// Modular tab components
import CustomerOverview from "../components/customer/CustomerOverview";
import CustomerProducts from "../components/customer/CustomerProducts";
import CustomerOrders from "../components/customer/CustomerOrders";
import CustomerReviews from "../components/customer/CustomerReviews";
import CustomerInteractions from "../components/customer/CustomerInteractions";
import CustomerAuditLogs from "../components/customer/CustomerAuditLogs";
import CustomerAiInsights from "../components/customer/CustomerAiInsights";

const normalizeList = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export default function Customer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const activeCustomerId = useRef(id);
  activeCustomerId.current = id;
  const loadedTabs = useRef({});
  const loadingTabRef = useRef(null);
  const [data, setData] = useState(null);
  const [loadingTab, setLoadingTab] = useState(null);
  const [tabError, setTabError] = useState("");
  const [tab, setTab] = useState("overview");
  const selectedTab = useRef(tab);
  selectedTab.current = tab;
  const [showForm, setShowForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showAddReview, setShowAddReview] = useState(false);
  const [editingReview, setEditingReview] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState(null);
  const [rescoreLoading, setRescoreLoading] = useState(false);
  const [bulkOrderDeleteLoading, setBulkOrderDeleteLoading] = useState(false);
  const [error, setError] = useState("");

  const handleManualRescore = async () => {
    setRescoreLoading(true);
    try {
      const freshPredictions = await predictionService.rescore(id);
      setData((prev) => ({
        ...prev,
        predictions: freshPredictions,
      }));
      toast.success("AI Model executed successfully! Predictions updated.");
      setTab("ai-insights");
    } catch (err) {
      toast.error(err.message || "Failed to execute AI model.");
    } finally {
      setRescoreLoading(false);
    }
  };

  const handleBulkOrderDelete = async (orderIds, clearSelection) => {
    if (!window.confirm(`Delete ${orderIds.length} selected order${orderIds.length === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }
    setBulkOrderDeleteLoading(true);
    try {
      await customerService.removeOrders(id, orderIds);
      publishDashboardDataChanged();
      clearSelection?.();
      toast.success(`${orderIds.length} order${orderIds.length === 1 ? "" : "s"} deleted successfully.`);
      await load();
      setTab("orders");
    } catch (err) {
      toast.error(err.message || "Failed to delete selected orders.");
    } finally {
      setBulkOrderDeleteLoading(false);
    }
  };

  const loadTabData = useCallback(async (targetTab, customerId = id, force = false) => {
    if (
      !force
      && (loadedTabs.current[`${customerId}:${targetTab}`]
        || loadingTabRef.current === targetTab)
    ) return;

    setTabError("");
    loadingTabRef.current = targetTab;
    setLoadingTab(targetTab);
    try {
      let updates;
      if (targetTab === "products") {
        updates = { products: normalizeList(await customerService.products(customerId)) };
      } else if (targetTab === "orders") {
        updates = { orders: normalizeList(await customerService.orders(customerId)) };
      } else if (targetTab === "reviews") {
        const [reviews, orders] = await Promise.all([
          customerService.reviews(customerId),
          customerService.orders(customerId),
        ]);
        updates = {
          reviews: normalizeList(reviews),
          orders: normalizeList(orders),
        };
      } else if (targetTab === "activity") {
        updates = { interactions: normalizeList(await customerService.interactions(customerId)) };
      } else if (targetTab === "audit") {
        updates = { auditLogs: normalizeList(await customerService.auditLogs(customerId)) };
      } else {
        return;
      }

      if (activeCustomerId.current !== customerId) return;
      setData((previous) => ({ ...previous, ...updates }));
      loadedTabs.current[`${customerId}:${targetTab}`] = true;
    } catch (requestError) {
      if (activeCustomerId.current === customerId) {
        setTabError(requestError.message || "Unable to load customer data.");
      }
    } finally {
      if (
        activeCustomerId.current === customerId
        && loadingTabRef.current === targetTab
      ) {
        loadingTabRef.current = null;
        setLoadingTab((current) => current === targetTab ? null : current);
      }
    }
  }, [id]);

  const load = useCallback(async (refreshActiveTab = true) => {
    const customerId = id;
    setError("");
    try {
      const detail = await customerService.detail(customerId);
      if (activeCustomerId.current !== customerId) return;
      setData((previous) => ({
        detail: detail || {},
        orders: previous?.orders || [],
        products: previous?.products || [],
        reviews: previous?.reviews || [],
        interactions: previous?.interactions || [],
        auditLogs: previous?.auditLogs || [],
        predictions: previous?.predictions || null,
      }));
      predictionService.get(customerId).then(
        (predictions) => {
          if (activeCustomerId.current === customerId) {
            setData((previous) => ({ ...previous, predictions }));
          }
        },
        () => {
          if (activeCustomerId.current === customerId) {
            setData((previous) => ({ ...previous, predictions: null }));
          }
        },
      );
      if (selectedTab.current !== "overview" && selectedTab.current !== "ai-insights") {
        await loadTabData(selectedTab.current, customerId, refreshActiveTab);
      }
    } catch (requestError) {
      if (activeCustomerId.current === customerId) {
        setError(requestError.message);
      }
    }
  }, [id, loadTabData]);

  const handleConfirmDelete = async () => {
    setDeleteLoading(true);
    setError("");
    try {
      await customerService.remove(id);
      publishDashboardDataChanged();
      setShowDeleteConfirm(false);
      toast.success("Customer deleted successfully.");
      navigate("/customers");
    } catch (requestError) {
      toast.error(requestError.message);
      setShowDeleteConfirm(false);
    } finally {
      setDeleteLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    loadedTabs.current = {};
    loadingTabRef.current = null;
    setLoadingTab(null);
    setTabError("");
    load(false);
  }, [id, load]);

  const hasCustomerData = Boolean(data);
  useEffect(() => {
    setTabError("");
    if (hasCustomerData && tab !== "overview" && tab !== "ai-insights") {
      loadTabData(tab);
    }
  }, [id, tab, hasCustomerData, loadTabData]);

  if (error)
    return (
      <Page>
        <ErrorState message={error} retry={load} />
      </Page>
    );

  if (!data)
    return (
      <Page>
        <LoadingState text="Loading customer intelligence..." />
      </Page>
    );

  const customer = data.detail || {};
  const predictions = data.predictions;
  const customerIdentifier = customer.customer_unique_id || customer.customer_id || "Customer";
  const heroInitial = customerIdentifier.charAt(0)?.toUpperCase() || "C";

  const mlClv = predictions?.clv?.predicted_clv;
  const realizedSpend = Number(customer.monetary_total || 0);
  const estimatedClv =
    mlClv != null
      ? Number(mlClv)
      : customer.customer_lifetime_value != null
      ? Number(customer.customer_lifetime_value)
      : realizedSpend;

  const mlSegmentLabel =
    typeof predictions?.segmentation?.segment_label === "string"
      ? predictions.segmentation.segment_label.trim()
      : "";
  const activeSegment = mlSegmentLabel || "ML segment unavailable";

  const features = [
    [
      "CLV (ML Predicted)",
      `R$ ${estimatedClv.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      WalletCards,
      "emerald",
    ],
    [
      "Total spend",
      `R$ ${Number(customer.monetary_total || 0).toLocaleString("en-US")}`,
      WalletCards,
    ],
    ["Frequency", `${customer.frequency || 0} orders`, Repeat2],
    ["Recency", `${customer.recency_days || 0} days`, TrendingUp],
    [
      "Avg review",
      `${Number(customer.avg_review_score || 0).toFixed(1)} / 5`,
      Star,
    ],
    [
      "Delivery",
      `${Number(customer.avg_delivery_days || 0).toFixed(1)} days`,
      Activity,
    ],
  ];

  return (
    <Page>
      <button className="back" onClick={() => navigate("/customers")}>
        <ArrowLeft size={16} /> Customers
      </button>

      <div className="profile">
        <div className="heroAvatar">{heroInitial}</div>
        <div className="profileText">
          <span>CONSUMER PROFILE · {activeSegment}</span>
          <h1>{customerIdentifier}</h1>
          <p>
            <MapPin size={14} /> {customer.customer_city || "Unknown city"},{" "}
            {customer.customer_state || "Unknown state"}
          </p>
        </div>
        {isAdmin && (
          <div className="actions">
            <button className="btn secondary" onClick={() => setShowEdit(true)}>
              Edit customer
            </button>
            <button className="btn secondary" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={16} /> Delete
            </button>
            <button className="btn primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Add activity
            </button>
          </div>
        )}
      </div>

      <div className="features">
        {features.map(([label, value, Icon]) => (
          <div key={label}>
            <Icon size={16} />
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <div className="tabs customerDetailTabs" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="customerDetailTabList" style={{ display: "flex", alignItems: "center" }}>
          {[
            ["overview", "Overview", TrendingUp],
            ["ai-insights", "AI Insights", BrainCircuit],
            ["products", "Products", Package],
            ["orders", "Orders", ShoppingBag],
            ["reviews", "Reviews", MessageSquare],
            ["activity", "Activity", Activity],
            ["audit", "Audit Log", History],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn secondary"
          onClick={handleManualRescore}
          disabled={rescoreLoading}
          title="Run calibrated LightGBM model manually to generate fresh predictions"
          style={{
            marginRight: 6,
            marginBottom: 4,
            padding: "5px 12px",
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <RefreshCw size={13} className={rescoreLoading ? "spin" : ""} style={{ color: "#6366f1" }} />
          {rescoreLoading ? "Scoring..." : "Run AI Model"}
        </button>
      </div>

      {tabError ? (
        <ErrorState message={tabError} retry={() => loadTabData(tab, id, true)} />
      ) : loadingTab === tab ? (
        <LoadingState text="Loading customer data..." />
      ) : (
        <>
          {tab === "overview" && (
            <CustomerOverview customer={customer} predictions={data.predictions} />
          )}
          {tab === "ai-insights" && (
            <CustomerAiInsights
              predictions={data.predictions}
              onRescore={handleManualRescore}
              rescoreLoading={rescoreLoading}
            />
          )}
          {tab === "products" && <CustomerProducts items={data.products} />}
          {tab === "orders" && (
            <CustomerOrders
              items={data.orders}
              isAdmin={isAdmin}
              onAddOrder={() => setShowAddOrder(true)}
              onEditOrder={(order) => setEditingOrder(order)}
              onBulkDelete={handleBulkOrderDelete}
              bulkDeleteLoading={bulkOrderDeleteLoading}
            />
          )}
          {tab === "reviews" && (
            <CustomerReviews
              items={data.reviews}
              orders={data.orders}
              isAdmin={isAdmin}
              onAddReview={() => setShowAddReview(true)}
              onEditReview={(review) => setEditingReview(review)}
            />
          )}
          {tab === "activity" && (
            <CustomerInteractions
              items={data.interactions}
              isAdmin={isAdmin}
              onEditInteraction={(interaction) => setEditingInteraction(interaction)}
            />
          )}
          {tab === "audit" && <CustomerAuditLogs items={data.auditLogs} />}
        </>
      )}

      {showForm && (
        <InteractionModal
          close={() => setShowForm(false)}
          save={async (payload) => {
            await customerService.addInteraction(id, payload);
            setShowForm(false);
            toast.success("Activity logged successfully.");
            await load();
            setTab("activity");
          }}
        />
      )}

      {editingInteraction && (
        <InteractionModal
          interaction={editingInteraction}
          close={() => setEditingInteraction(null)}
          save={async (payload) => {
            await customerService.updateInteraction(id, editingInteraction.id, payload);
            setEditingInteraction(null);
            toast.success("Activity updated successfully.");
            await load();
            setTab("activity");
          }}
        />
      )}

      {showEdit && (
        <CustomerModal
          customer={customer}
          close={() => setShowEdit(false)}
          save={async (payload) => {
            await customerService.update(id, payload);
            publishDashboardDataChanged();
            setShowEdit(false);
            toast.success("Customer profile updated.");
            await load();
          }}
        />
      )}

      {showAddOrder && (
        <OrderModal
          close={() => setShowAddOrder(false)}
          save={async (payload) => {
            await customerService.createOrder(id, payload);
            publishDashboardDataChanged();
            setShowAddOrder(false);
            toast.success("Order placed successfully.");
            await load();
            setTab("orders");
          }}
        />
      )}

      {editingOrder && (
        <OrderModal
          order={editingOrder}
          close={() => setEditingOrder(null)}
          save={async (payload) => {
            await customerService.updateOrder(id, editingOrder.order_id, payload);
            publishDashboardDataChanged();
            setEditingOrder(null);
            toast.success("Order updated successfully.");
            await load();
            setTab("orders");
          }}
          onDelete={async (orderId) => {
            await customerService.removeOrder(id, orderId);
            publishDashboardDataChanged();
            setEditingOrder(null);
            toast.success("Order deleted successfully.");
            await load();
            setTab("orders");
          }}
        />
      )}

      {showAddReview && (
        <ReviewModal
          orders={data.orders}
          existingReviews={data.reviews}
          close={() => setShowAddReview(false)}
          save={async (payload) => {
            await customerService.createReview(id, payload);
            publishDashboardDataChanged();
            setShowAddReview(false);
            toast.success("Review added successfully.");
            await load();
            setTab("reviews");
          }}
        />
      )}

      {editingReview && (
        <ReviewModal
          review={editingReview}
          orders={data.orders}
          existingReviews={data.reviews}
          close={() => setEditingReview(null)}
          save={async (payload) => {
            await customerService.updateReview(id, editingReview.review_id, payload);
            publishDashboardDataChanged();
            setEditingReview(null);
            toast.success("Review updated successfully.");
            await load();
            setTab("reviews");
          }}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Customer Profile?"
          message={`Are you sure you want to delete customer ${customerIdentifier}? Customers with active order history cannot be deleted.`}
          confirmLabel="Delete Customer"
          isDanger={true}
          loading={deleteLoading}
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </Page>
  );
}
