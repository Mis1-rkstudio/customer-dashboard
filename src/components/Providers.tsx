// src/components/Providers.tsx
'use client';

import React from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { CartProvider } from '@/context/CartContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={"pk_test_YnVzeS1sYW1iLTIwLmNsZXJrLmFjY291bnRzLmRldiQ"}>
      <CartProvider>{children}</CartProvider>
    </ClerkProvider>
  );
}
