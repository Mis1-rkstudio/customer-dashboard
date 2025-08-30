'use client';
import React, { useEffect, useState } from 'react';
import Select from 'react-select';
import { FaTrash, FaPencilAlt } from 'react-icons/fa';

export default function OrderForm({ closeModal, refreshOrders }) {
  const [step, setStep] = useState(1);

  // fetched data
  const [customers, setCustomers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [availableItems, setAvailableItems] = useState([]);

  // step1
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentPhone, setAgentPhone] = useState('');

  // step2
  const [orderItems, setOrderItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const [availableColors, setAvailableColors] = useState([]); // for selected item
  const [selectedColors, setSelectedColors] = useState([]); // user-selected colors (array)
  const [currentQty, setCurrentQty] = useState(''); // blank initially
  const [editingIndex, setEditingIndex] = useState(null); // index for editing a row

  // global
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [itemError, setItemError] = useState('');
  const [step1Error, setStep1Error] = useState('');

  const customStyles = {
    control: (provided) => ({
      ...provided,
      backgroundColor: '#1f2937',
      borderColor: '#374151',
      color: 'white',
      minHeight: '42px',
    }),
    singleValue: (provided) => ({ ...provided, color: 'white' }),
    menu: (provided) => ({ ...provided, backgroundColor: '#1f2937' }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#374151' : '#1f2937',
      color: 'white',
    }),
    input: (provided) => ({ ...provided, color: 'white' }),
    placeholder: (provided) => ({ ...provided, color: '#9ca3af' }),
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const [customersRes, agentsRes, itemsRes] = await Promise.all([
          fetch('/api/customers'),
          fetch('/api/agents'),
          fetch('/api/items'),
        ]);

        const customersData = customersRes.ok ? await customersRes.json() : { rows: [] };
        const agentsData = agentsRes.ok ? await agentsRes.json() : { rows: [] };
        const itemsData = itemsRes.ok ? await itemsRes.json() : { rows: [] };

        if (customersData.rows && Array.isArray(customersData.rows)) {
          setCustomers(
            customersData.rows.map((c) => ({
              ...c,
              value: c.Company_Name ?? c.company_name ?? String(c.id ?? ''),
              label: `${c.Company_Name ?? c.company_name ?? 'Unknown'}${c.City ? ` [${c.City}]` : ''}`,
            }))
          );
        }

        if (agentsData.rows && Array.isArray(agentsData.rows)) {
          setAgents(
            agentsData.rows.map((a) => ({
              ...a,
              value: a.Company_Name ?? a.name ?? String(a.id ?? ''),
              label: a.Company_Name ?? a.name ?? String(a.id ?? ''),
              number: a.Number ?? a.phone ?? a.Contact_Number ?? a.contact_number ?? '',
            }))
          );
        }

        if (itemsData.rows && Array.isArray(itemsData.rows)) {
          const normalized = itemsData.rows.map((i) => {
            let colors = [];
            if (Array.isArray(i.Colors)) colors = i.Colors;
            else if (Array.isArray(i.colors)) colors = i.colors;
            else if (i.colors_string) colors = String(i.colors_string).split(',').map((s) => s.trim()).filter(Boolean);
            else if (i.Color) colors = [String(i.Color).trim()];

            colors = Array.from(new Set(colors.map((c) => String(c || '').trim()).filter((c) => c && c.toLowerCase() !== 'nan')));

            return {
              ...i,
              value: i.Item ?? i.sku ?? String(i.id ?? ''),
              label: i.Item ?? i.sku ?? String(i.id ?? ''),
              colors,
            };
          });
          setAvailableItems(normalized);
        }
      } catch (err) {
        console.error('fetchData error', err);
        setError('Failed to load necessary data.');
      }
    }
    fetchData();
  }, []);

  // Autofill agent if customer's Broker/Agent_Name matches an agent
  useEffect(() => {
    if (!selectedCustomer) {
      setSelectedAgent(null);
      setAgentPhone('');
      setCustomerEmail('');
      setCustomerPhone('');
      return;
    }

    setCustomerEmail(selectedCustomer.Email ?? selectedCustomer.email ?? '');
    setCustomerPhone(selectedCustomer.Number ?? selectedCustomer.phone ?? '');

    const brokerName = (selectedCustomer.Broker ?? selectedCustomer.Agent_Name ?? selectedCustomer.broker ?? '').toString().trim();
    if (brokerName) {
      const found = agents.find((a) => {
        const name = (a.Company_Name ?? a.value ?? a.label ?? '').toString().trim();
        return name && name.toLowerCase() === brokerName.toLowerCase();
      });
      if (found) {
        setSelectedAgent(found);
        setAgentPhone(found.number ?? found.phone ?? found.Contact_Number ?? '');
        return;
      }
    }

    const agentById = agents.find(
      (a) => String(a.id ?? a.agent_id ?? '').toLowerCase() === String(selectedCustomer.agent_id ?? selectedCustomer.Agent_ID ?? '').toLowerCase()
    );
    if (agentById) {
      setSelectedAgent(agentById);
      setAgentPhone(agentById.number ?? agentById.phone ?? '');
      return;
    }

    setSelectedAgent(null);
    setAgentPhone('');
  }, [selectedCustomer, agents]);

  const handleCustomerChange = (opt) => {
    setSelectedCustomer(opt || null);
    setStep1Error('');
    setError('');
  };

  const handleAgentChange = (opt) => {
    setSelectedAgent(opt || null);
    setAgentPhone(opt?.number ?? opt?.phone ?? '');
    setStep1Error('');
  };

  // WHEN AN ITEM IS SELECTED -> populate availableColors with all colors for that item
  const handleItemChange = (opt) => {
    setCurrentItem(opt || null);
    setSelectedColors([]);
    setCurrentQty('');
    setItemError('');
    setEditingIndex(null);

    if (opt && Array.isArray(opt.colors) && opt.colors.length > 0) {
      setAvailableColors(opt.colors);
    } else {
      setAvailableColors([]);
    }
  };

  const toggleColor = (color) => {
    setSelectedColors((prev) => (prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]));
    setItemError('');
  };

  // Validation conditions: at least 3 colors, qty > 0
  const canAddOrUpdate = () => {
    const qtyNum = Number(currentQty);
    return currentItem && Array.isArray(selectedColors) && selectedColors.length >= 3 && !Number.isNaN(qtyNum) && qtyNum > 0;
  };

  const handleAddOrUpdateItem = () => {
    setItemError('');
    if (!currentItem) {
      setItemError('Please select an item.');
      return;
    }
    const qty = Number(currentQty);
    if (currentQty === '' || Number.isNaN(qty) || qty <= 0) {
      setItemError('Quantity must be a number greater than 0.');
      return;
    }
    if (!selectedColors || selectedColors.length < 3) {
      setItemError('Please select at least 3 colors before adding.');
      return;
    }

    // if editing a single existing row: update that row (we only allow one-color per row for edit)
    if (editingIndex !== null && editingIndex >= 0 && editingIndex < orderItems.length) {
      const updated = [...orderItems];
      // when editing we update the row to first selected color (consistent with single-row edit)
      updated[editingIndex] = {
        item: currentItem,
        color: selectedColors[0],
        quantity: qty,
      };
      setOrderItems(updated);
      setEditingIndex(null);
    } else {
      // create new entries: one row per selected color (user selected at least 3)
      const newEntries = selectedColors.map((col) => ({
        item: currentItem,
        color: col,
        quantity: qty,
      }));
      setOrderItems((prev) => [...prev, ...newEntries]);
    }

    // reset inputs
    setCurrentItem(null);
    setAvailableColors([]);
    setSelectedColors([]);
    setCurrentQty('');
  };

  const handleEditRow = (index) => {
    const row = orderItems[index];
    if (!row) return;
    setEditingIndex(index);
    setCurrentItem(row.item ?? null);
    setAvailableColors(row.item?.colors ?? []);
    setSelectedColors([row.color]);
    setCurrentQty(row.quantity ?? '');
    setStep(2);
  };

  const handleDeleteRow = (index) => {
    setOrderItems((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setCurrentItem(null);
      setAvailableColors([]);
      setSelectedColors([]);
      setCurrentQty('');
    }
  };

  const validateStep1 = () => {
    if (!selectedCustomer) {
      setStep1Error('Please select a customer.');
      return false;
    }
    if (!selectedAgent) {
      setStep1Error('Please select an agent.');
      return false;
    }
    setStep1Error('');
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validateStep1()) return;
    if (orderItems.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }
    // ensure all rows have valid qty > 0
    for (const r of orderItems) {
      if (!r.quantity || Number.isNaN(Number(r.quantity)) || Number(r.quantity) <= 0) {
        setError('All order items must have quantity > 0.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        customer: {
          id: selectedCustomer.id ?? selectedCustomer.value ?? null,
          name: selectedCustomer.label ?? selectedCustomer.value ?? '',
          email: customerEmail,
          phone: customerPhone,
        },
        agent: {
          id: selectedAgent?.id ?? selectedAgent?.value ?? null,
          name: selectedAgent?.label ?? selectedAgent?.value ?? '',
          number: agentPhone,
        },
        items: orderItems.map((it) => ({
          sku: it.item?.value ?? it.item?.Item ?? it.item?.sku ?? '',
          itemName: it.item?.label ?? it.item?.Item ?? '',
          color: it.color,
          quantity: parseInt(it.quantity, 10),
        })),
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          setError(json.error || 'Failed to create order.');
        } else {
          setError('Failed to create order.');
        }
      } else {
        refreshOrders && refreshOrders();
        closeModal && closeModal();
      }
    } catch (err) {
      console.error('submit error', err);
      setError('An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Create Order</h2>

      {error && <div className="text-red-400 bg-red-900/30 border border-red-700 p-3 rounded mb-4">{error}</div>}

      {step === 1 ? (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Customer</label>
            <Select styles={customStyles} options={customers} value={selectedCustomer} onChange={handleCustomerChange} isClearable isSearchable placeholder="Select customer..." />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
              <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-2 px-3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Phone</label>
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-2 px-3" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Agent</label>
            <Select styles={customStyles} options={agents} value={selectedAgent} onChange={handleAgentChange} isClearable isSearchable placeholder="Select agent..." />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Agent Phone</label>
            <input value={agentPhone} readOnly className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-2 px-3" />
          </div>

          {step1Error && <div className="text-red-400 mb-4">{step1Error}</div>}

          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={() => {
                if (validateStep1()) {
                  setStep(2);
                  setError('');
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md"
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Item</label>
              <Select
                styles={customStyles}
                options={availableItems}
                value={currentItem}
                onChange={handleItemChange}
                placeholder="Select item..."
                isClearable
                isSearchable
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Quantity (in sets)</label>
              <input
                type="number"
                min="1"
                value={currentQty}
                onChange={(e) => setCurrentQty(e.target.value)}
                placeholder=""
                className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-2 px-3"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Colors (click to select)</label>

            <div className="p-3 border border-gray-700 rounded bg-gray-900 min-h-[56px] flex flex-wrap gap-2">
              {availableColors.length === 0 ? (
                <div className="text-gray-400">Select an item to see its available colors.</div>
              ) : (
                availableColors.map((c) => {
                  const selected = selectedColors.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleColor(c)}
                      className={`px-3 py-1 rounded-full text-sm font-semibold focus:outline-none transition ${
                        selected ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-2 text-xs text-gray-400">
              <span>Minimum 3 colors required.</span>
            </div>

            {itemError && <div className="text-red-400 mt-2">{itemError}</div>}
          </div>

          <div className="flex justify-end mb-4 gap-3">
            <button
              type="button"
              onClick={() => {
                handleAddOrUpdateItem();
              }}
              disabled={!canAddOrUpdate()}
              className={`bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {editingIndex !== null ? 'Update Item' : 'Add Item'}
            </button>
          </div>

          {/* Items table */}
          <div className="mb-6 overflow-x-auto">
            <h3 className="text-lg font-semibold text-white mb-2">Order Items</h3>
            <table className="min-w-full divide-y divide-gray-700 bg-gray-900 rounded-md">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm text-gray-300">Item Name</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-300">Color</th>
                  <th className="px-4 py-3 text-right text-sm text-gray-300">Quantity</th>
                  <th className="px-4 py-3 text-center text-sm text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {orderItems.map((it, idx) => (
                  <tr key={idx} className="bg-gray-800">
                    <td className="px-4 py-3 text-sm text-gray-100">{it.item?.label ?? it.item?.Item ?? it.item?.value}</td>
                    <td className="px-4 py-3 text-sm text-gray-200">{it.color}</td>
                    <td className="px-4 py-3 text-sm text-gray-200 text-right">{it.quantity}</td>
                    <td className="px-4 py-3 text-sm text-gray-200 text-center">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditRow(idx);
                          }}
                          title="Edit"
                          className="p-2 rounded hover:bg-gray-700"
                        >
                          <FaPencilAlt className="text-yellow-400" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRow(idx);
                          }}
                          title="Delete"
                          className="p-2 rounded hover:bg-gray-700"
                        >
                          <FaTrash className="text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {orderItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                      No items added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between mt-6">
            <button type="button" onClick={() => setStep(1)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md">
              Back
            </button>

            <button
              type="submit"
              disabled={isSubmitting || orderItems.length === 0}
              className={`flex items-center gap-2 ${isSubmitting ? 'bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'} text-white font-bold py-2 px-4 rounded-md disabled:opacity-60`}
            >
              {isSubmitting ? (
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : null}
              <span>{isSubmitting ? '' : 'Create Order'}</span>
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
