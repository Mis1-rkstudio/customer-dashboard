'use client';

import React, { JSX, useEffect } from 'react';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
};

export default function Modal({ isOpen, onClose, children }: ModalProps): JSX.Element | null {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div
        className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold">Create Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close modal">
            ×
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
