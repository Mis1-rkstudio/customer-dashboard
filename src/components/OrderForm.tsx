'use client';
import React, { JSX, useEffect, useState } from 'react';
import CreatableSelect from 'react-select/creatable';
import { StylesConfig, CSSObjectWithLabel } from 'react-select';
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

/* --- small helpers --- */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
function normKey(s: unknown) {
  return String(s ?? '').trim().toLowerCase();
}

/* --- FS create helper --- */
async function createFsDoc(
  collection: 'customers' | 'agents' | 'items',
  body: Record<string, unknown>
): Promise<{ id: string }> {
  const res = await fetch(`/api/fs/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const jsonBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !jsonBody?.id) {
    const errMsg = (jsonBody?.error ?? jsonBody?.message) ?? `Failed to create ${collection}`;
    throw new Error(String(errMsg));
  }
  return { id: String(jsonBody.id) };
}

/* -------------------------
   component
   ------------------------- */
export default function OrderForm({
  closeModal,
  refreshOrders,
  createOrder, // optional prop
}: {
  closeModal?: () => void;
  refreshOrders?: () => void;
  createOrder?: (data: unknown) => Promise<unknown>;
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

  // confirmation toggle
  const [isConfirmed, setIsConfirmed] = useState<boolean>(true);

  // step2
  const [orderItems, setOrderItems] = useState<OrderRow[]>([]);
  const [currentItem, setCurrentItem] = useState<ItemType | null>(null);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [currentQty, setCurrentQty] = useState<string>('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // global
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [itemError, setItemError] = useState<string>('');
  const [step1Error, setStep1Error] = useState<string>('');

  const customStyles: StylesConfig<OptionType | ItemType, false> = {
    control: (provided: CSSObjectWithLabel) => ({
      ...provided,
      backgroundColor: '#1f2937',
      borderColor: '#374151',
      color: 'white',
      minHeight: '42px',
    }),
    singleValue: (provided: CSSObjectWithLabel) => ({ ...provided, color: 'white' }),
    menu: (provided: CSSObjectWithLabel) => ({ ...provided, backgroundColor: '#1f2937' }),
    option: (
      provided: CSSObjectWithLabel,
      state: { isSelected?: boolean; isFocused?: boolean }
    ) => ({
      ...provided,
      backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#374151' : '#1f2937',
      color: 'white',
    }),
    input: (provided: CSSObjectWithLabel) => ({ ...provided, color: 'white' }),
    placeholder: (provided: CSSObjectWithLabel) => ({ ...provided, color: '#9ca3af' }),
  };

  /* -------------------------
     Helpers: normalize, merge, find
     ------------------------- */
  function mergeOptions(primary: OptionType[], secondary: OptionType[]): OptionType[] {
    const map = new Map<string, OptionType>();
    const put = (o: OptionType) => {
      const key = normKey(o.Company_Name ?? o.value ?? o.label);
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...o });
      } else {
        const entries = Object.entries(o).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '');
        const merged = { ...prev, ...Object.fromEntries(entries) } as OptionType;
        map.set(key, merged);
      }
    };
    primary.forEach(put);
    secondary.forEach(put);
    return Array.from(map.values());
  }

  function findExistingOption(list: OptionType[], name: string): OptionType | undefined {
    const key = normKey(name);
    return list.find((o) => {
      const candidate = normKey(o.Company_Name ?? o.label ?? o.value);
      return candidate === key;
    });
  }

  /* -------------------------
     Parse / normalise fetch responses (accept [] or { rows: [] })
     ------------------------- */
  const normalizeListResponse = async (res: Response): Promise<unknown[]> => {
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    if (Array.isArray(json)) return json;
    if (isObject(json) && Array.isArray((json as Record<string, unknown>).rows)) return (json as Record<string, unknown>).rows as unknown[];
    if (isObject(json) && Array.isArray((json as Record<string, unknown>).orders)) return (json as Record<string, unknown>).orders as unknown[];
    // If the endpoint returns an object map, attempt to extract values
    if (isObject(json)) return Object.values(json);
    return [];
  };

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

        const customersBQ = await normalizeListResponse(customersRes);
        const agentsBQ = await normalizeListResponse(agentsRes);
        const itemsBQ = await normalizeListResponse(itemsRes);

        const customersFS = await normalizeListResponse(fsCustomersRes);
        const agentsFS = await normalizeListResponse(fsAgentsRes);
        const itemsFS = await normalizeListResponse(fsItemsRes);

        const mapCustomer = (cRaw: unknown): OptionType => {
          const c = (cRaw ?? {}) as Record<string, unknown>;
          const company = (c.Company_Name ?? c.company_name ?? c.label ?? '') as string;
          const city = (c.City ?? '') as string;
          return {
            ...c,
            value: (company || String(c.id ?? '')),
            label: `${company || 'Unknown'}${city ? ` [${city}]` : ''}`,
            Company_Name: company,
            Email: (c.Email ?? c.email ?? '') as string,
            Number: (c.Number ?? c.phone ?? '') as string,
            Broker: (c.Broker ?? '') as string,
            Agent_Name: (c.Agent_Name ?? '') as string,
            id: (c.id ?? c._id ?? c.id) as string | number | undefined,
          } as OptionType;
        };

        const mapAgent = (aRaw: unknown): OptionType => {
          const a = (aRaw ?? {}) as Record<string, unknown>;
          const name = (a.Company_Name ?? a.name ?? a.label ?? '') as string;
          return {
            ...a,
            value: (name || String(a.id ?? '')),
            label: name || String(a.id ?? ''),
            Company_Name: name,
            number: (a.Number ?? a.phone ?? a.Contact_Number ?? a.contact_number ?? '') as string,
            id: (a.id ?? a._id ?? a.id) as string | number | undefined,
          } as OptionType;
        };

        const mapItem = (iRaw: unknown): ItemType => {
          const i = (iRaw ?? {}) as Record<string, unknown>;
          let colors: string[] = [];
          if (Array.isArray(i.Colors)) colors = (i.Colors as unknown[]).map(String);
          else if (Array.isArray(i.colors)) colors = (i.colors as unknown[]).map(String);
          else if (i.colors_string) colors = String(i.colors_string).split(',').map((s) => s.trim()).filter(Boolean);
          else if (i.Color) colors = [String(i.Color).trim()];

          colors = Array.from(new Set(colors.map((c) => String(c || '').trim()).filter(Boolean)));
          const label = (i.Item ?? i.sku ?? i.label ?? String(i.id ?? '')) as string;
          return {
            ...i,
            value: label,
            label,
            colors,
            id: (i.id ?? i._id ?? i.id) as string | number | undefined,
          } as ItemType;
        };

        const mappedCustomersBQ: OptionType[] = (customersBQ as unknown[]).map(mapCustomer);
        const mappedCustomersFS: OptionType[] = (customersFS as unknown[]).map(mapCustomer);
        const mergedCustomers = mergeOptions(mappedCustomersBQ, mappedCustomersFS);

        const mappedAgentsBQ: OptionType[] = (agentsBQ as unknown[]).map(mapAgent);
        const mappedAgentsFS: OptionType[] = (agentsFS as unknown[]).map(mapAgent);
        const mergedAgents = mergeOptions(mappedAgentsBQ, mappedAgentsFS);

        const mappedItems = [
          ...(Array.isArray(itemsBQ) ? (itemsBQ as unknown[]).map(mapItem) : []),
          ...(Array.isArray(itemsFS) ? (itemsFS as unknown[]).map(mapItem) : []),
        ];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
     Creatable handlers
     ------------------------- */
  async function handleCreateCustomer(input: string): Promise<void> {
    const name = input.trim();
    if (!name) return;
    const existing = findExistingOption(customers, name);
    if (existing) {
      setSelectedCustomer(existing);
      setCustomerEmail((existing.Email as string) ?? (existing.email as string) ?? '');
      setCustomerPhone((existing.Number as string) ?? (existing.phone as string) ?? '');
      return;
    }

    const optimistic: OptionType = { value: name, label: name, Company_Name: name, Email: customerEmail, Number: customerPhone };
    setCustomers((prev) => [optimistic, ...prev]);
    setSelectedCustomer(optimistic);

    try {
      const payload = { Company_Name: name, Email: customerEmail ?? '', Number: customerPhone ?? '' };
      const { id } = await createFsDoc('customers', payload);
      setCustomers((prev) => prev.map((c) => (normKey(c.value) === normKey(optimistic.value) ? { ...c, id } : c)));
    } catch (errUnknown) {
      console.error('create customer error', errUnknown);
      setError('Could not save new customer.');
      setCustomers((prev) => prev.filter((c) => normKey(c.value) !== normKey(optimistic.value)));
      setSelectedCustomer(null);
    }
  }

  async function handleCreateAgent(input: string): Promise<void> {
    const name = input.trim();
    if (!name) return;
    const existing = findExistingOption(agents, name);
    if (existing) {
      setSelectedAgent(existing);
      setAgentPhone((existing.number as string) ?? (existing.phone as string) ?? '');
      return;
    }

    const optimistic: OptionType = { value: name, label: name, Company_Name: name, number: agentPhone ?? '' };
    setAgents((prev) => [optimistic, ...prev]);
    setSelectedAgent(optimistic);

    try {
      const payload = { Company_Name: name, Number: agentPhone ?? '' };
      const { id } = await createFsDoc('agents', payload);
      setAgents((prev) => prev.map((a) => (normKey(a.value) === normKey(optimistic.value) ? { ...a, id } : a)));
    } catch (errUnknown) {
      console.error('create agent error', errUnknown);
      setError('Could not save new agent.');
      setAgents((prev) => prev.filter((a) => normKey(a.value) !== normKey(optimistic.value)));
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
      setAvailableItems((prev) => prev.map((i) => (normKey(i.value) === normKey(optimistic.value) ? { ...i, id } : i)));
    } catch (errUnknown) {
      console.error('create item error', errUnknown);
      setError('Could not save new item.');
      setAvailableItems((prev) => prev.filter((i) => normKey(i.value) !== normKey(optimistic.value)));
      setCurrentItem(null);
    }
  }

  /* --- helpers to merge order rows (avoid duplicates) --- */
  function addOrMergeRows(existing: OrderRow[], newRows: OrderRow[]): OrderRow[] {
    // key: item.value + '||' + color
    const map = new Map<string, OrderRow>();
    for (const r of existing) {
      const key = `${normKey(r.item?.value ?? r.item?.label ?? '')}||${normKey(r.color)}`;
      map.set(key, { ...r, quantity: Number(r.quantity) || 0 });
    }
    for (const r of newRows) {
      const key = `${normKey(r.item?.value ?? r.item?.label ?? '')}||${normKey(r.color)}`;
      const existingRow = map.get(key);
      if (existingRow) {
        existingRow.quantity = Number(existingRow.quantity) + Number(r.quantity);
        map.set(key, existingRow);
      } else {
        map.set(key, { ...r, quantity: Number(r.quantity) || 0 });
      }
    }
    return Array.from(map.values());
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
      setAvailableColors((opt.colors as unknown[]).map(String));
    } else {
      setAvailableColors([]);
    }
  };

  const toggleColor = (color: string): void => {
    setSelectedColors((prev) => (prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]));
    setItemError('');
  };

  const minColorsRequired = (): number => {
    if (availableColors.length >= 3) return 3;
    if (availableColors.length >= 1) return 1;
    return 0;
  };

  const canAddOrUpdate = (): boolean => {
    const qtyNum = Number(currentQty);
    const minReq = minColorsRequired();
    const selectedCount = Array.isArray(selectedColors) ? selectedColors.length : 0;
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

    let newEntries: OrderRow[] = [];
    if (selCount > 0) {
      newEntries = selectedColors.map((col) => ({
        item: currentItem,
        color: col,
        quantity: qty,
      }));
    } else {
      newEntries = [{ item: currentItem, color: '', quantity: qty }];
    }

    if (editingIndex !== null && editingIndex >= 0 && editingIndex < orderItems.length) {
      // replace the single edited row with potentially multiple new rows
      const updated = [...orderItems];
      updated.splice(editingIndex, 1, ...newEntries);
      setOrderItems(addOrMergeRows(updated, [])); // make sure merging duplicates after replace
      setEditingIndex(null);
    } else {
      // append and merge duplicates
      setOrderItems((prev) => addOrMergeRows(prev, newEntries));
    }

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
          sku: it.item?.sku ?? it.item?.value ?? '',
          itemName: it.item?.label ?? it.item?.Item ?? '',
          color: it.color,
          quantity: Number(it.quantity),
        })),
        orderStatus: isConfirmed ? 'Confirmed' : 'Unconfirmed',
      };

      // If parent provided createOrder, use it. Otherwise, fall back to direct API call.
      let body: unknown = null;
      if (typeof createOrder === 'function') {
        body = await createOrder(payload);
      } else {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const ct = res.headers.get('content-type') ?? '';
        body = ct.includes('application/json') ? (await res.json().catch(() => null)) : null;
        if (!res.ok) {
          const serverMsg = isObject(body) && typeof (body as Record<string, unknown>).message === 'string'
            ? (body as Record<string, unknown>).message
            : `HTTP ${res.status}`;
          throw new Error(String(serverMsg));
        }
      }

      // If server returned structured error details, show them safely
      // if (isObject(body)) {
      //   if ((body as Record<string, unknown>).bigQueryError) {
      //     const maybeErr = (body as Record<string, unknown>).bigQueryError;
      //     const details = typeof maybeErr === 'string' ? maybeErr : JSON.stringify(maybeErr, null, 2);
      //     window.alert(`BigQuery INSERT FAILED — full error details:\n\n${details}`);
      //     if (typeof refreshOrders === 'function') await refreshOrders();
      //     if (typeof closeModal === 'function') closeModal();
      //     return;
      //   }
      //   const bigQ = (body as Record<string, unknown>).bigQuery;
      //   if (isObject(bigQ) && typeof (bigQ as Record<string, unknown>).totalErrors === 'number' && (bigQ as Record<string, unknown>).totalErrors > 0) {
      //     const summary = JSON.stringify(bigQ, null, 2);
      //     window.alert(`BigQuery reported ${(bigQ as Record<string, unknown>).totalErrors} row errors. Full summary:\n\n${summary}`);
      //     if (typeof refreshOrders === 'function') await refreshOrders();
      //     if (typeof closeModal === 'function') closeModal();
      //     return;
      //   }
      // }

      // If server returned structured error details, show them safely
      if (isObject(body)) {
        if ((body as Record<string, unknown>).bigQueryError) {
          const maybeErr = (body as Record<string, unknown>).bigQueryError;
          const details = typeof maybeErr === 'string' ? maybeErr : JSON.stringify(maybeErr, null, 2);
          window.alert(`BigQuery INSERT FAILED — full error details:\n\n${details}`);
          if (typeof refreshOrders === 'function') await refreshOrders();
          if (typeof closeModal === 'function') closeModal();
          return;
        }

        // safe narrow for the detailed BigQuery object
        const bigQ = (body as Record<string, unknown>).bigQuery;
        if (isObject(bigQ)) {
          const bqRec = bigQ as Record<string, unknown>;
          const totalErrors = bqRec.totalErrors;
          if (typeof totalErrors === 'number' && totalErrors > 0) {
            const summary = JSON.stringify(bqRec, null, 2);
            window.alert(`BigQuery reported ${totalErrors} row errors. Full summary:\n\n${summary}`);
            if (typeof refreshOrders === 'function') await refreshOrders();
            if (typeof closeModal === 'function') closeModal();
            return;
          }
        }
      }

      if (typeof refreshOrders === 'function') {
        try { await refreshOrders(); } catch (e) { console.warn('refreshOrders failed after create:', e); }
      }
      if (typeof closeModal === 'function') closeModal();
    } catch (errUnknown) {
      console.error('submit error', errUnknown);
      const msg = errUnknown instanceof Error ? errUnknown.message : String(errUnknown);
      setError('An unexpected error occurred.');
      window.alert(`Failed to create order — unexpected error:\n\n${msg}`);
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
          {/* Step 1 UI (unchanged) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Customer</label>
            <CreatableSelect<OptionType, false>
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
            <CreatableSelect<OptionType, false>
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
          {/* Step 2 UI (unchanged) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Item</label>
              <CreatableSelect<ItemType, false>
                styles={customStyles}
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

          {/* Status + Submit (unchanged) */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-sm text-gray-300 font-medium">Order Status</div>
                <div className="text-xs text-gray-400">{isConfirmed ? 'Confirmed' : 'Unconfirmed'}</div>
              </div>

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

            <div className="text-sm text-gray-400">(This will be saved to the database as a string)</div>
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
