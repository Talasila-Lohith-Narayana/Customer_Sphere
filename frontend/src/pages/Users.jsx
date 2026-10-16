import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { KeyRound, Pencil, Plus, Shield, Trash2, UserPlus, Users as UsersIcon, X } from "lucide-react";
import { ErrorState, Header, LoadingState, Page, Panel } from "../components/States";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { userService } from "../services/api";
import DataTable from "../components/DataTable";
import { ACCESS_PAGES, DEFAULT_VIEWER_ACCESS } from "../accessPages";
import { announceSessionRevocation } from "../services/sessionEvents";

const emptyForm = { username: "", password: "", role: "viewer", access_pages: [] };

export default function Users() {
  const {
    isAdmin,
    user: currentUser,
    updateCurrentSession,
    updateAccountAccess,
  } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [activeSection, setActiveSection] = useState("manage");
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    username: "",
    password: "",
    access_pages: [],
  });
  const [editBusy, setEditBusy] = useState(false);
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setUsers(await userService.list());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void loadUsers();
  }, [isAdmin, loadUsers]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    if (form.role === "viewer" && form.access_pages.length === 0) {
      toast.error("Select at least one page for this user.");
      return;
    }
    setBusy(true);
    try {
      const created = await userService.create(form);
      setUsers((current) =>
        [...current, created].sort((left, right) =>
          left.username.localeCompare(right.username),
        ),
      );
      window.dispatchEvent(new Event("profiles-updated"));
      setForm(emptyForm);
      toast.success(`User "${created.username}" can now sign in.`);
      setActiveSection("manage");
    } catch (requestError) {
      toast.error(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function startEditing(account) {
    setEditingUser(account);
    setEditForm({
      username: account.username,
      password: "",
      access_pages: account.access_pages || DEFAULT_VIEWER_ACCESS,
    });
  }

  async function saveUser(event) {
    event.preventDefault();
    if (editingUser.role === "viewer" && editForm.access_pages.length === 0) {
      toast.error("Select at least one page for this user.");
      return;
    }
    setEditBusy(true);
    const changes = { username: editForm.username };
    if (editForm.password) changes.password = editForm.password;
    if (editingUser.role === "viewer") {
      changes.access_pages = editForm.access_pages;
    }
    try {
      const updated = await userService.update(editingUser.username, changes);
      if (updated.sessions_revoked) {
        announceSessionRevocation(editingUser.username);
        if (updated.username !== editingUser.username) {
          announceSessionRevocation(updated.username);
        }
      } else {
        updateAccountAccess?.(updated.username, updated.access_pages);
        if (editingUser.username === currentUser) {
          updateCurrentSession?.({
            ...updated,
            access_token: updated.access_token,
          });
        }
      }
      setUsers((current) =>
        current
          .map((account) =>
            account.username === editingUser.username
              ? {
                username: updated.username,
                role: updated.role,
                access_pages: updated.access_pages,
              }
              : account,
          )
          .sort((left, right) => left.username.localeCompare(right.username)),
      );
      window.dispatchEvent(new Event("profiles-updated"));
      setEditingUser(null);
      setEditForm({ username: "", password: "", access_pages: [] });
      toast.success(`User "${updated.username}" updated.`);
    } catch (requestError) {
      toast.error(requestError.message);
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDeleteUser() {
    if (!deletingUser) return;
    setDeleteBusy(true);
    try {
      await userService.delete(deletingUser.username);
      setUsers((current) =>
        current.filter((account) => account.username !== deletingUser.username),
      );
      window.dispatchEvent(new Event("profiles-updated"));
      toast.success(`User "${deletingUser.username}" deleted.`);
      setDeletingUser(null);
    } catch (requestError) {
      toast.error(requestError.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const adminCount = users.filter((account) => account.role === "admin").length;

  const columns = [
    {
      header: "Username",
      accessorKey: "username",
      cell: ({ row }) => <span className="userTableName"><UsersIcon size={15} />{row.original.username}</span>,
    },
    {
      header: "Role",
      accessorKey: "role",
      cell: ({ row }) => <span className={`userRoleBadge ${row.original.role}`}>{row.original.role === "admin" ? <Shield size={13} /> : <KeyRound size={13} />}{row.original.role === "admin" ? "Administrator" : "Viewer"}</span>,
    },
    {
      header: "Page access",
      accessorKey: "access_pages",
      cell: ({ row }) => row.original.role === "admin"
        ? "All pages"
        : (row.original.access_pages || []).map((page) =>
          ACCESS_PAGES.find((item) => item.key === page)?.label || page,
        ).join(", ") || "No pages",
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const account = row.original;
        return <div className="userActions">
          <button className="btn ghost userEditButton" type="button" onClick={() => startEditing(account)} aria-label={`Edit ${account.username}`} title={`Edit ${account.username}`}><Pencil size={13} /></button>
          <button className="btn danger userDeleteButton" type="button" onClick={() => setDeletingUser(account)} aria-label={`Delete ${account.username}`} title={account.username === currentUser ? "You cannot delete your active account" : account.role === "admin" && adminCount <= 1 ? "The last administrator cannot be deleted" : `Delete ${account.username}`} disabled={account.username === currentUser || (account.role === "admin" && adminCount <= 1)}><Trash2 size={13} /></button>
        </div>;
      },
    },
  ];

  return (
    <Page>
      <Header
        eyebrow="ACCESS CONTROL"
        title="User management"
        text="Create accounts for people who need access to Customer Sphere."
      />

      <div className="tabs modelTabs userManagementTabs" role="tablist" aria-label="User management sections">
        <button
          id="users-manage-tab"
          type="button"
          role="tab"
          className={activeSection === "manage" ? "active" : ""}
          aria-selected={activeSection === "manage"}
          aria-controls="users-manage-panel"
          onClick={() => setActiveSection("manage")}
        >
          <UsersIcon size={15} />
          View &amp; edit users
        </button>
        <button
          id="users-create-tab"
          type="button"
          role="tab"
          className={activeSection === "create" ? "active" : ""}
          aria-selected={activeSection === "create"}
          aria-controls="users-create-panel"
          onClick={() => setActiveSection("create")}
        >
          <UserPlus size={15} />
          Create user
        </button>
      </div>

      {activeSection === "create" ? (
        <section
          id="users-create-panel"
          className="userManagementPanel"
          role="tabpanel"
          aria-labelledby="users-create-tab"
        >
          <Panel
            title="Create an account"
            sub="Choose which pages the new user can view. Administrators always have full access."
          >
            <form className="userCreateForm" onSubmit={submit}>
              <div className="userCredentialFields">
                <div className="userCredentialField">
                  <label htmlFor="new-username">Username</label>
                  <input
                    id="new-username"
                    autoComplete="off"
                    minLength={3}
                    maxLength={80}
                    required
                    value={form.username}
                    onChange={(event) =>
                      setForm({ ...form, username: event.target.value })
                    }
                  />
                </div>
                <div className="userCredentialField">
                  <label htmlFor="new-temporary-password">Temporary password</label>
                  <input
                    id="new-temporary-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={form.password}
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                  />
                  <small>Use at least 8 characters.</small>
                </div>
              </div>
              <fieldset className="userAccessFieldset">
                <legend>Page access</legend>
                <div className="userAccessOptions">
                  {ACCESS_PAGES.map(({ key, label }) => (
                    <label key={key} className="userAccessOption">
                      <input
                        type="checkbox"
                        checked={form.role === "admin" || form.access_pages.includes(key)}
                        disabled={form.role === "admin"}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            access_pages: event.target.checked
                              ? [...current.access_pages, key]
                              : current.access_pages.filter((page) => page !== key),
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <label className="userAdminAccessOption">
                  <input
                    type="checkbox"
                    checked={form.role === "admin"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        role: event.target.checked ? "admin" : "viewer",
                      }))
                    }
                  />
                  <span>Administrator — full access to all pages and actions</span>
                </label>
              </fieldset>
              <button className="btn primary" type="submit" disabled={busy}>
                <Plus size={15} />
                {busy ? "Creating..." : "Create user"}
              </button>
            </form>
          </Panel>
        </section>
      ) : (
        <section
          id="users-manage-panel"
          className="userManagementPanel"
          role="tabpanel"
          aria-labelledby="users-manage-tab"
        >
          <Panel
            title="Application users"
            sub={`${users.length} account${users.length === 1 ? "" : "s"} can sign in. Edit account details or remove access here.`}
          >
            {loading ? (
              <LoadingState text="Loading users..." />
            ) : error ? (
              <ErrorState message={error} retry={loadUsers} />
            ) : (
              <div className="userTableWrap">
                <DataTable columns={columns} data={users} />
              </div>
            )}
          </Panel>
        </section>
      )}
      {editingUser && (
        <div className="modalBg">
          <form
            className="modal userEditModal"
            onSubmit={saveUser}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editingUser.username}`}
          >
            <button
              type="button"
              className="close"
              onClick={() => setEditingUser(null)}
              aria-label="Close edit user dialog"
              disabled={editBusy}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">ACCOUNT SETTINGS</p>
            <h2>Edit user</h2>
            <label>
              Username
              <input
                autoComplete="off"
                minLength={3}
                maxLength={80}
                required
                value={editForm.username}
                onChange={(event) =>
                  setEditForm({ ...editForm, username: event.target.value })
                }
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={editForm.password}
                onChange={(event) =>
                  setEditForm({ ...editForm, password: event.target.value })
                }
                placeholder="Leave blank to keep current password"
              />
              <small>Enter at least 8 characters to change the password.</small>
            </label>
            <fieldset className="userAccessFieldset">
              <legend>Page access</legend>
              <div className="userAccessOptions">
                {ACCESS_PAGES.map(({ key, label }) => (
                  <label key={key} className="userAccessOption">
                    <input
                      type="checkbox"
                      checked={editingUser.role === "admin" || editForm.access_pages.includes(key)}
                      disabled={editingUser.role === "admin" || editBusy}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          access_pages: event.target.checked
                            ? [...current.access_pages, key]
                            : current.access_pages.filter((page) => page !== key),
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {editingUser.role === "admin" && (
                <p className="filterHint">
                  Administrators always have full access to every page.
                </p>
              )}
            </fieldset>
            <div className="actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setEditingUser(null)}
                disabled={editBusy}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={editBusy}>
                {editBusy ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
      {deletingUser && (
        <ConfirmModal
          title="Delete user?"
          message={`Delete "${deletingUser.username}"? They will no longer be able to sign in, and their active sessions will be revoked. This action cannot be undone.`}
          confirmLabel="Delete user"
          loading={deleteBusy}
          onConfirm={confirmDeleteUser}
          onCancel={() => setDeletingUser(null)}
        />
      )}
    </Page>
  );
}
