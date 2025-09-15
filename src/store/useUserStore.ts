// src/store/useUserStore.ts
import { create } from "zustand";

export type UserStoreState = {
  name: string | null;
  email: string | null; // logged-in Clerk email
  currentUserId: string | null; // unique id (row_id) for the active internal user
  currentUserEmail: string | null; // convenience for display (keeps email too)
  customers: string[];
  loadingCustomers: boolean;
  selectedCustomer: string | null;

  setUser: (payload: { name?: string | null; email?: string | null }) => void;
  setCurrentUser: (email: string | null) => void;
  setCurrentUserId: (id: string | null) => void;
  setCustomers: (customers: string[]) => void;
  setLoadingCustomers: (v: boolean) => void;
  setSelectedCustomer: (c: string | null) => void;
  clearUser: () => void;
};

export const useUserStore = create<UserStoreState>((set) => ({
  name: null,
  email: null,
  currentUserId: null,
  currentUserEmail: null,
  customers: [],
  loadingCustomers: false,
  selectedCustomer: null,

  setUser: (payload) =>
    set((state) => ({
      name: payload.name ?? null,
      email: payload.email ?? null,
      // initialize currentUserEmail only when null (don't stomp manual switches)
      currentUserEmail: state.currentUserEmail ?? payload.email ?? null,
    })),

  setCurrentUser: (email) =>
    set(() => ({
      currentUserEmail: email ?? null,
    })),

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
      currentUserId: null,
      currentUserEmail: null,
      customers: [],
      loadingCustomers: false,
      selectedCustomer: null,
    })),
}));
