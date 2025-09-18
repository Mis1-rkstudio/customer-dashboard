// src/components/Header.tsx
"use client";

import React, { JSX } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import { useCart } from "@/context/CartContext";
import useSyncUser from "@/hooks/useSyncUser";
import UserSwitcher from "@/components/UserSwitcher";
import { useUserStore } from "@/store/useUserStore";

export default function Header(): JSX.Element {
  useSyncUser(); // keeps store synced after sign-in

  const pathname = usePathname();
  const { cartItems } = useCart();
  const itemsCount = Array.isArray(cartItems) ? cartItems.length : 0;

  // Clerk user to detect admin role
  const { user } = useUser();
  type ClerkUserLite = { publicMetadata?: Record<string, unknown> };
  const typedUser = user as unknown as ClerkUserLite | undefined;
  const isAdmin = Boolean(
    typedUser?.publicMetadata &&
      String(typedUser.publicMetadata.role ?? "").toLowerCase() === "admin"
  );

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/orders", label: "Orders" },
    { href: "/items", label: "Items" },
  ];

  return (
    <header className="bg-slate-900 text-white shadow-sm">
      <nav className="container mx-auto px-6 py-3 flex items-center">
        {/* Brand: fixed on left */}
        <div className="flex-shrink-0">
          <Link href="/" className="text-2xl font-bold whitespace-nowrap">
            Order Management
          </Link>
        </div>

        {/* Right group: pushed to the right with ml-auto.
            Order inside: (admin active/user switcher) → nav links → auth/profile */}
        <div className="ml-auto flex items-center gap-6">
          {/* admin-only: active email pill + user switcher */}
          {isAdmin && (
            <div className="hidden sm:flex items-center gap-4 whitespace-nowrap">
              {/* hide on small screens to avoid crowding */}
              <div className="hidden md:block">
                <UserSwitcher />
              </div>
            </div>
          )}

          {/* Nav links — keep them compact and non-wrapping */}
          <ul className="flex items-center gap-6">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`transition-colors hover:text-blue-400 whitespace-nowrap ${
                    pathname === link.href ? "text-blue-500 font-semibold" : "text-white"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Auth area (cart + user) */}
          <SignedOut>
            <div className="flex items-center gap-2">
              <SignInButton>
                <button className="px-3 py-1 rounded bg-transparent border border-white/20 text-sm hover:bg-white/5">
                  Sign in
                </button>
              </SignInButton>

              <SignUpButton>
                <button className="px-3 py-1 rounded bg-blue-600 text-sm font-medium hover:bg-blue-500">
                  Sign up
                </button>
              </SignUpButton>
            </div>
          </SignedOut>

          <SignedIn>
            <div className="flex items-center gap-3">
              <Link
                href="/cart"
                className="relative inline-flex items-center p-1 rounded hover:text-blue-400 transition-colors"
                aria-label={`Cart — ${itemsCount} items`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>

                {itemsCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {itemsCount}
                  </span>
                )}
              </Link>

              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}
