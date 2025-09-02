'use client';
import React, { JSX, useEffect, useState } from 'react';
import CreatableSelect from 'react-select/creatable';
import { StylesConfig } from 'react-select';
import { FaTrash, FaPencilAlt } from 'react-icons/fa';

/* --- Types --- */
type OptionType = {
  value: string;
  label: string;
  id?: string | number;
  Company_Name?: string;
  Email?: string;
  email?: string;
  Number?: string;
  phone?: string;
  Broker?: string;
  Agent_Name?: string;
  agent_id?: string | number;
  number?: string;
  [k: string]: unknown;
};

type ItemType = OptionType & {
  Item?: string;
  sku?: string;
  Colors?: unknown;
  colors?: unknown;
  colors_string?: unknown;
};

type OrderRow = {
  item: ItemType;
  color: string;
  quantity: number | string;
};

/* --- Props --- */
export default function OrderForm({
  closeModal,
  refreshOrders,
}: {
  closeModal?: () => void;
  refreshOrders?: () => void;
}): JSX.Element {
  const [step, setStep] = useState<number>(1);

  // fetched data
  const [customers, setCustomers] = useState<OptionType[]>([]);
  const [agents, setAgents] = useState<OptionType[]>([]);
  const [availableItems, setAvailableItems] = useState<ItemType[]>([]);

  // loading flags for dropdowns
  const [loadingCustomers, setLoadingCustomers] = useState<boolean>(true);
  const [loadingAgents, setLoadingAgents] = useState<boolean>(true);
  const [loadingItems, setLoadingItems] = useState<boolean>(true);

  // step1
  const [selectedCustomer, setSelectedCustomer] = useState<OptionType | null>(null);
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<OptionType | null>(null);
  const [agentPhone, setAgentPhone] = useState<string>('');

  // order confirmation toggle (iPhone style)
  // kept at top-level of the form so it's preserved between steps
  const [isConfirmed, setIsConfirmed] = useState<boolean>(true);

  // step2
  const [orderItems, setOrderItems] = useState<OrderRow[]>([]);
  const [currentItem, setCurrentItem] = useState<ItemType | null>(null);
  const [availableColors, setAvailableColors] = useState<string[]>([]); // for selected item
  const [selectedColors, setSelectedColors] = useState<string[]>([]); // user-selected colors (array)
  const [currentQty, setCurrentQty] = useState<string>(''); // blank initially
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // index for editing a row

  // global
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [itemError, setItemError] = useState<string>('');
  const [step1Error, setStep1Error] = useState<string>('');

  /* --- react-select style typing --- */
  const customStyles: StylesConfig<OptionType, false> = {
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

  /* -------------------------
     Helpers: normalize, merge, FS create
     ------------------------- */
  function normKey(s: unknown) {
    return String(s ?? '').trim().toLowerCase();
  }

  // Merge arrays by Company_Name / value / label (prefer existing non-empty fields)
  function mergeOptions(primary: OptionType[], secondary: OptionType[]) {
    const map = new Map<string, OptionType>();
    const put = (o: OptionType) => {
      const key = normKey((o as any).Company_Name ?? o.value ?? o.label);
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...o });
      } else {
        // shallow merge: keep fields from prev if present, else take from o
        map.set(key, {
          ...prev,
          ...Object.fromEntries(
            Object.entries(o).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
          ),
        });
      }
    };
    primary.forEach(put);
    secondary.forEach(put);
    return Array.from(map.values());
  }

  // POST helper to server route that uses firebase-admin
  async function createFsDoc(
    collection: 'customers' | 'agents' | 'items',
    body: Record<string, unknown>
  ): Promise<{ id: string }> {
    const res = await fetch(`/api/fs/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.id) {
      throw new Error((json as any).error ?? `Failed to create ${collection}`);
    }
    return { id: (json as any).id as string };
  }

  function findExistingOption(list: OptionType[], name: string): OptionType | undefined {
    const key = normKey(name);
    return list.find((o) => {
      const candidate = normKey((o as any).Company_Name ?? o.label ?? o.value);
      return candidate === key;
    });
  }

  /* -------------------------
     Fetch & merge BQ + Firestore
     ------------------------- */
  useEffect(() => {
    async function fetchData(): Promise<void> {
      setLoadingCustomers(true);
      setLoadingAgents(true);
      setLoadingItems(true);
      setError('');
      try {
        const [customersRes, agentsRes, itemsRes, fsCustomersRes, fsAgentsRes, fsItemsRes] = await Promise.all([
          fetch('/api/customers'),
          fetch('/api/agents'),
          fetch('/api/items'),
          fetch('/api/fs/customers'),
          fetch('/api/fs/agents'),
          fetch('/api/fs/items'),
        ]);

        const customersBQ = (customersRes.ok ? await customersRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];
        const agentsBQ = (agentsRes.ok ? await agentsRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];
        const itemsBQ = (itemsRes.ok ? await itemsRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];

        const customersFS = (fsCustomersRes.ok ? await fsCustomersRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];
        const agentsFS = (fsAgentsRes.ok ? await fsAgentsRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];
        const itemsFS = (fsItemsRes.ok ? await fsItemsRes.json().catch(() => ({ rows: [] })) : { rows: [] }).rows ?? [];

        // mappers
        const mapCustomer = (cRaw: any): OptionType => {
          const c = cRaw ?? {};
          const company = c.Company_Name ?? c.company_name ?? '';
          const city = c.City ?? '';
          return {
            ...c,
            value: (company || String(c.id ?? '')),
            label: `${company || 'Unknown'}${city ? ` [${city}]` : ''}`,
            Company_Name: company,
            Email: c.Email ?? c.email ?? '',
            Number: c.Number ?? c.phone ?? '',
            Broker: c.Broker ?? '',
            Agent_Name: c.Agent_Name ?? '',
            id: c.id ?? c._id ?? c.id,
          } as OptionType;
        };

        const mapAgent = (aRaw: any): OptionType => {
          const a = aRaw ?? {};
          const name = a.Company_Name ?? a.name ?? '';
          return {
            ...a,
            value: (name || String(a.id ?? '')),
            label: name || String(a.id ?? ''),
            Company_Name: name,
            number: a.Number ?? a.phone ?? a.Contact_Number ?? a.contact_number ?? '',
            id: a.id ?? a._id ?? a.id,
          } as OptionType;
        };

        const mapItem = (iRaw: any): ItemType => {
          const i = iRaw ?? {};
          let colors: string[] = [];
          if (Array.isArray(i.Colors)) colors = (i.Colors as unknown[]).map(String);
          else if (Array.isArray(i.colors)) colors = (i.colors as unknown[]).map(String);
          else if (i.colors_string) colors = String(i.colors_string).split(',').map((s: string) => s.trim()).filter(Boolean);
          else if (i.Color) colors = [String(i.Color).trim()];

          colors = Array.from(new Set(colors.map((c) => String(c || '').trim()).filter(Boolean)));

          const label = i.Item ?? i.sku ?? String(i.id ?? '');
          return {
            ...i,
            value: label,
            label,
            colors,
            id: i.id ?? i._id ?? i.id,
          } as ItemType;
        };

        // Build mapped arrays
        const mappedCustomersBQ = customersBQ.map(mapCustomer);
        const mappedCustomersFS = customersFS.map(mapCustomer);
        const mergedCustomers = mergeOptions(mappedCustomersBQ, mappedCustomersFS);

        const mappedAgentsBQ = agentsBQ.map(mapAgent);
        const mappedAgentsFS = agentsFS.map(mapAgent);
        const mergedAgents = mergeOptions(mappedAgentsBQ, mappedAgentsFS);

        const mappedItems = [...(itemsBQ.map(mapItem)), ...(itemsFS.map(mapItem))];
        // dedupe items by value
        const itemMap = new Map<string, ItemType>();
        for (const it of mappedItems) {
          itemMap.set(normKey(it.value), it);
        }
        const mergedItems = Array.from(itemMap.values());

        setCustomers(mergedCustomers);
        setAgents(mergedAgents);
        setAvailableItems(mergedItems);
      } catch (errUnknown) {
        console.error('fetchData error', errUnknown);
        setError('Failed to load necessary data.');
      } finally {
        setLoadingCustomers(false);
        setLoadingAgents(false);
        setLoadingItems(false);
      }
    }
    void fetchData();
  }, []);

  /* -------------------------
     Autofill agent when customer chosen
     ------------------------- */
  useEffect(() => {
    if (!selectedCustomer) {
      setSelectedAgent(null);
      setAgentPhone('');
      setCustomerEmail('');
      setCustomerPhone('');
      return;
    }

    const sc = selectedCustomer as Record<string, unknown>;
    setCustomerEmail(((sc.Email as string) ?? (sc.email as string) ?? '') as string);
    setCustomerPhone(((sc.Number as string) ?? (sc.phone as string) ?? '') as string);

    const brokerName = String(sc.Broker ?? sc.Agent_Name ?? sc.broker ?? '').trim();
    if (brokerName) {
      const found = agents.find((a) => {
        const name = String(a.Company_Name ?? a.value ?? a.label ?? '').trim();
        return name && name.toLowerCase() === brokerName.toLowerCase();
      });
      if (found) {
        setSelectedAgent(found);
        setAgentPhone(((found.number as string) ?? (found.phone as string) ?? (found.Contact_Number as string) ?? '') as string);
        return;
      }
    }

    const agentById = agents.find(
      (a) => String(a.id ?? a.agent_id ?? '').toLowerCase() === String((sc.agent_id ?? sc.Agent_ID ?? '') as string).toLowerCase()
    );
    if (agentById) {
      setSelectedAgent(agentById);
      setAgentPhone(((agentById.number as string) ?? (agentById.phone as string) ?? '') as string);
      return;
    }

    setSelectedAgent(null);
    setAgentPhone('');
  }, [selectedCustomer, agents]);

  /* -------------------------
     Creatable: create handlers (optimistic + POST)
     - Saves customer email & phone (when creating customer)
     - Saves agent phone (when creating agent)
     ------------------------- */
  async function handleCreateCustomer(input: string): Promise<void> {
    const name = input.trim();
    if (!name) return;
    // duplicate guard
    const existing = findExistingOption(customers, name);
    if (existing) {
      setSelectedCustomer(existing);
      // if existing has contact info, populate inputs
      setCustomerEmail((existing.Email as string) ?? (existing.email as string) ?? '');
      setCustomerPhone((existing.Number as string) ?? (existing.phone as string) ?? '');
      return;
    }

    // include current email/phone values (may be blank)
    const optimistic: OptionType = { value: name, label: name, Company_Name: name, Email: customerEmail, Number: customerPhone };
    setCustomers((prev) => [optimistic, ...prev]);
    setSelectedCustomer(optimistic);

    try {
      // include email/number in saved doc
      const payload = { Company_Name: name, Email: customerEmail ?? '', Number: customerPhone ?? '' };
      const { id } = await createFsDoc('customers', payload);
      setCustomers((prev) => prev.map((c) => (c === optimistic ? { ...c, id } : c)));
    } catch (errUnknown) {
      console.error('create customer error', errUnknown);
      setError('Could not save new customer.');
      setCustomers((prev) => prev.filter((c) => c !== optimistic));
      setSelectedCustomer(null);
    }
  }

  async function handleCreateAgent(input: string): Promise<void> {
    const name = input.trim();
    if (!name) return;
    const existing = findExistingOption(agents, name);
    if (existing) {
      setSelectedAgent(existing);
      setAgentPhone((existing as any).number ?? (existing as any).phone ?? '');
      return;
    }

    const optimistic: OptionType = { value: name, label: name, Company_Name: name, number: agentPhone ?? '' };
    setAgents((prev) => [optimistic, ...prev]);
    setSelectedAgent(optimistic);

    try {
      // include phone in saved doc
      const payload = { Company_Name: name, Number: agentPhone ?? '' };
      const { id } = await createFsDoc('agents', payload);
      setAgents((prev) => prev.map((a) => (a === optimistic ? { ...a, id } : a)));
    } catch (errUnknown) {
      console.error('create agent error', errUnknown);
      setError('Could not save new agent.');
      setAgents((prev) => prev.filter((a) => a !== optimistic));
      setSelectedAgent(null);
    }
  }

  async function handleCreateItem(input: string): Promise<void> {
    const name = input.trim();
    if (!name) return;
    const key = normKey(name);
    const existing = availableItems.find((it) => normKey(it.value) === key || normKey(it.label) === key);
    if (existing) {
      setCurrentItem(existing);
      setAvailableColors(existing.colors ? (existing.colors as string[]).map(String) : []);
      return;
    }

    const optimistic: ItemType = { value: name, label: name, colors: [] };
    setAvailableItems((prev) => [optimistic, ...prev]);
    setCurrentItem(optimistic);
    setAvailableColors([]);

    try {
      const { id } = await createFsDoc('items', { Item: name, Colors: [] });
      setAvailableItems((prev) => prev.map((i) => (i === optimistic ? { ...i, id } : i)));
    } catch (errUnknown) {
      console.error('create item error', errUnknown);
      setError('Could not save new item.');
      setAvailableItems((prev) => prev.filter((i) => i !== optimistic));
      setCurrentItem(null);
    }
  }

  /* --- handlers with typed params --- */
  const handleCustomerChange = (opt: OptionType | null): void => {
    setSelectedCustomer(opt);
    setStep1Error('');
    setError('');
  };

  const handleAgentChange = (opt: OptionType | null): void => {
    setSelectedAgent(opt);
    setAgentPhone(((opt as Record<string, unknown>)?.number as string) ?? ((opt as Record<string, unknown>)?.phone as string) ?? '');
    setStep1Error('');
  };

  const handleItemChange = (opt: ItemType | null): void => {
    setCurrentItem(opt);
    setSelectedColors([]);
    setCurrentQty('');
    setItemError('');
    setEditingIndex(null);

    if (opt && Array.isArray(opt.colors) && opt.colors.length > 0) {
      setAvailableColors(opt.colors.map(String));
    } else {
      setAvailableColors([]);
    }
  };

  const toggleColor = (color: string): void => {
    setSelectedColors((prev) => (prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]));
    setItemError('');
  };

  // Determine minimum colors required for the selected item:
  // - if availableColors >= 3 => require 3
  // - if availableColors 1 or 2 => require 1
  // - if availableColors === 0 => require 0 (allow adding without color)
  const minColorsRequired = (): number => {
    if (availableColors.length >= 3) return 3;
    if (availableColors.length >= 1) return 1;
    return 0;
  };

  // Validation conditions adjusted to allow items with <3 colors
  const canAddOrUpdate = (): boolean => {
    const qtyNum = Number(currentQty);
    const minReq = minColorsRequired();
    const selectedCount = Array.isArray(selectedColors) ? selectedColors.length : 0;
    // selectedCount must be >= minReq
    return !!currentItem && selectedCount >= minReq && !Number.isNaN(qtyNum) && qtyNum > 0;
  };

  const handleAddOrUpdateItem = (): void => {
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

    const minReq = minColorsRequired();
    const selCount = selectedColors.length;

    if (minReq > 0 && selCount < minReq) {
      setItemError(`Please select at least ${minReq} color${minReq > 1 ? 's' : ''} before adding.`);
      return;
    }

    // Build entries:
    // - If selectedColors has items, create one row per selected color (existing behavior)
    // - If selectedColors is empty (minReq === 0), create a single row with color = ""
    let newEntries: OrderRow[] = [];
    if (selCount > 0) {
      newEntries = selectedColors.map((col) => ({
        item: currentItem,
        color: col,
        quantity: qty,
      }));
    } else {
      // no colors available / selected -> create single row with empty color
      newEntries = [
        {
          item: currentItem,
          color: '',
          quantity: qty,
        },
      ];
    }

    if (editingIndex !== null && editingIndex >= 0 && editingIndex < orderItems.length) {
      // If editing, replace that single row with the first new entry (editing expects 1 row)
      const updated = [...orderItems];
      updated[editingIndex] = newEntries[0];
      setOrderItems(updated);
      setEditingIndex(null);
    } else {
      setOrderItems((prev) => [...prev, ...newEntries]);
    }

    // reset inputs
    setCurrentItem(null);
    setAvailableColors([]);
    setSelectedColors([]);
    setCurrentQty('');
  };

  const handleEditRow = (index: number): void => {
    const row = orderItems[index];
    if (!row) return;
    setEditingIndex(index);
    setCurrentItem(row.item ?? null);
    setAvailableColors(row.item?.colors ? (row.item.colors as unknown[]).map(String) : []);
    setSelectedColors(row.color ? [row.color] : []);
    setCurrentQty(String(row.quantity ?? ''));
    setStep(2);
  };

  const handleDeleteRow = (index: number): void => {
    setOrderItems((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setCurrentItem(null);
      setAvailableColors([]);
      setSelectedColors([]);
      setCurrentQty('');
    }
  };

  const validateStep1 = (): boolean => {
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
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
          id: selectedCustomer?.id ?? selectedCustomer?.value ?? null,
          name: selectedCustomer?.label ?? selectedCustomer?.value ?? '',
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
          quantity: parseInt(String(it.quantity), 10),
        })),
        // Order status (saved to DB as string)
        orderStatus: isConfirmed ? 'Confirmed' : 'Unconfirmed',
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = await res.json().catch(() => ({}));
          setError((json as Record<string, unknown>).error as string ?? 'Failed to create order.');
        } else {
          setError('Failed to create order.');
        }
      } else {
        if (typeof refreshOrders === 'function') refreshOrders();
        if (typeof closeModal === 'function') closeModal();
      }
    } catch (errUnknown) {
      console.error('submit error', errUnknown);
      setError('An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* -------------------------
     Render
     ------------------------- */
  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Create Order</h2>

      {error && <div className="text-red-400 bg-red-900/30 border border-red-700 p-3 rounded mb-4">{error}</div>}

      {step === 1 ? (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Customer</label>
            <CreatableSelect
              styles={customStyles}
              options={customers}
              value={selectedCustomer}
              onChange={(opt) => handleCustomerChange(opt as OptionType | null)}
              onCreateOption={(input) => { void handleCreateCustomer(input); }}
              isClearable
              isSearchable
              isLoading={loadingCustomers}
              isDisabled={loadingCustomers}
              placeholder={loadingCustomers ? 'Loading customers...' : 'Select or type to add customer...'}
            />
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
            <CreatableSelect
              styles={customStyles}
              options={agents}
              value={selectedAgent}
              onChange={(opt) => handleAgentChange(opt as OptionType | null)}
              onCreateOption={(input) => { void handleCreateAgent(input); }}
              isClearable
              isSearchable
              isLoading={loadingAgents}
              isDisabled={loadingAgents}
              placeholder={loadingAgents ? 'Loading agents...' : 'Select or type to add agent...'}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Agent Phone</label>
            <input value={agentPhone} onChange={(e) => setAgentPhone(e.target.value)} className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-2 px-3" />
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
              <CreatableSelect
                styles={customStyles as any}
                options={availableItems}
                value={currentItem}
                onChange={(opt) => handleItemChange(opt as ItemType | null)}
                onCreateOption={(input) => { void handleCreateItem(input); }}
                placeholder={loadingItems ? 'Loading items...' : 'Select item...'}
                isClearable
                isSearchable
                isLoading={loadingItems}
                isDisabled={loadingItems}
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
                      className={`px-3 py-1 rounded-full text-sm font-semibold focus:outline-none transition ${selected ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                    >
                      {c}
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-2 text-xs text-gray-400">
              <span>
                {availableColors.length >= 3
                  ? 'Minimum 3 colors required.'
                  : availableColors.length >= 1
                    ? 'Select at least 1 color.'
                    : 'No colors available — you may add the item without selecting colors.'}
              </span>
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
                    <td className="px-4 py-3 text-sm text-gray-200">{it.color || '—'}</td>
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

          {/* Show current Order Status right above the Create Order button */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-sm text-gray-300 font-medium">Order Status</div>
                <div className="text-xs text-gray-400">{isConfirmed ? 'Confirmed' : 'Unconfirmed'}</div>
              </div>

              {/* iPhone-style toggle for Confirmed / Unconfirmed (moved here) */}
              <button
                type="button"
                role="switch"
                aria-checked={isConfirmed}
                onClick={() => setIsConfirmed((s) => !s)}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${isConfirmed ? 'bg-green-500' : 'bg-gray-600'}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isConfirmed ? 'translate-x-7' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <div className="text-sm text-gray-400">
              (This will be saved to the database as a string)
            </div>
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
