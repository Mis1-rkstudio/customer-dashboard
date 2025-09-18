// src/store/useUserStore.ts
import { create } from "zustand";

export type UserStoreState = {
  name: string | null;
  email: string | null; // logged-in Clerk email
  currentUser: string | null; // selected display value (either "You" email or customer name/email)
  currentUserId: string | null; // stable id for selected internal user (row_id or "me:<id>" or "customer:<id>")
  currentUserEmail: string | null; // convenience if the currentUser is an email
  customers: string[];
  loadingCustomers: boolean;
  selectedCustomer: string | null;

  setUser: (payload: { name?: string | null; email?: string | null }) => void;
  setCurrentUser: (displayValue: string | null, id?: string | null) => void;
  setCurrentUserId: (id: string | null) => void;
  setCustomers: (customers: string[]) => void;
  setLoadingCustomers: (v: boolean) => void;
  setSelectedCustomer: (c: string | null) => void;
  clearUser: () => void;
};

export const useUserStore = create<UserStoreState>((set, get) => ({
  name: null,
  email: null,
  currentUser: null,
  currentUserId: null,
  currentUserEmail: null,
  customers: [],
  loadingCustomers: false,
  selectedCustomer: null,

  /**
   * Set basic user info from Clerk sync hook.
   * We only initialize currentUser when it's currently null to avoid stomping a manual selection.
   */
  setUser: (payload) =>
    set((state) => {
      const nextEmail = payload.email ?? null;
      const nextName = payload.name ?? null;

      // Only initialize currentUser when it's not already set (so manual selection stays)
      const nextCurrentUser = state.currentUser ?? nextEmail ?? null;

      const looksLikeEmail =
        typeof nextCurrentUser === "string" && nextCurrentUser.includes("@");

      return {
        name: nextName,
        email: nextEmail,
        currentUser: nextCurrentUser,
        currentUserEmail: looksLikeEmail ? nextCurrentUser : state.currentUserEmail ?? nextEmail,
      };
    }),

  /**
   * Set the active selection shown in the UI.
   * displayValue: user-visible label (email or customer name)
   * id: optional stable id (e.g. "me:<uid>" or "customer:<row_id>")
   */
  setCurrentUser: (displayValue, id) =>
    set(() => {
      const next = displayValue ?? null;
      const looksLikeEmail = typeof next === "string" && next.includes("@");

      return {
        currentUser: next,
        currentUserId: id ?? null,
        currentUserEmail: looksLikeEmail ? next : null,
      };
    }),

  setCurrentUserId: (id) =>
    set(() => ({
      currentUserId: id ?? null,
    })),

  setCustomers: (customers) =>
    set(() => ({
      customers: Array.isArray(customers) ? customers : [],
    })),

  setLoadingCustomers: (v: boolean) =>
    set(() => ({
      loadingCustomers: Boolean(v),
    })),

  setSelectedCustomer: (c: string | null) =>
    set(() => ({
      selectedCustomer: c ?? null,
    })),

  clearUser: () =>
    set(() => ({
      name: null,
      email: null,
      currentUser: null,
      currentUserId: null,
      currentUserEmail: null,
      customers: [],
      loadingCustomers: false,
      selectedCustomer: null,
    })),
}));
