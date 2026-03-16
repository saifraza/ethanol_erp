import { useState, useEffect } from 'react';
import { Users, Plus, X, Save, Loader2, Trash2, Search, ChevronDown } from 'lucide-react';
import api from '../../services/api';

interface Customer {
  id: string;
  name: string;
  shortName?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNo?: string;
  panNo?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  creditLimit?: number;
  defaultTerms?: string;
  outstandingBalance?: number;
  active?: boolean;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [gstNo, setGstNo] = useState('');
  const [panNo, setPanNo] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [defaultTerms, setDefaultTerms] = useState('COD');

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/customers');
      setCustomers(response.data.customers || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load customers' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.shortName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setName('');
    setShortName('');
    setAddress('');
    setCity('');
    setState('');
    setPincode('');
    setGstNo('');
    setPanNo('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setCreditLimit('');
    setDefaultTerms('COD');
    setEditId(null);
    setShowForm(false);
  };

  const openForm = (customer?: Customer) => {
    if (customer) {
      setEditId(customer.id);
      setName(customer.name);
      setShortName(customer.shortName || '');
      setAddress(customer.address || '');
      setCity(customer.city || '');
      setState(customer.state || '');
      setPincode(customer.pincode || '');
      setGstNo(customer.gstNo || '');
      setPanNo(customer.panNo || '');
      setContactPerson(customer.contactPerson || '');
      setPhone(customer.phone || '');
      setEmail(customer.email || '');
      setCreditLimit(customer.creditLimit?.toString() || '');
      setDefaultTerms(customer.defaultTerms || 'COD');
    }
    setShowForm(true);
  };

  async function saveCustomer() {
    if (!name.trim()) {
      setMsg({ type: 'err', text: 'Customer name is required' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        name,
        shortName,
        address,
        city,
        state,
        pincode,
        gstNo,
        panNo,
        contactPerson,
        phone,
        email,
        creditLimit: creditLimit ? parseFloat(creditLimit) : undefined,
        defaultTerms,
      };

      if (editId) {
        await api.put(`/customers/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Customer updated!' });
      } else {
        await api.post('/customers', payload);
        setMsg({ type: 'ok', text: 'Customer created!' });
      }

      resetForm();
      loadCustomers();
    } catch (error) {
      setMsg({ type: 'err', text: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer(id: string) {
    if (!confirm('Deactivate this customer?')) return;
    try {
      await api.delete(`/customers/${id}`);
      setMsg({ type: 'ok', text: 'Customer deactivated!' });
      loadCustomers();
    } catch (error) {
      setMsg({ type: 'err', text: 'Delete failed' });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 md:py-6">
          <div className="flex items-center gap-3 mb-2">
            <Users size={32} />
            <h1 className="text-2xl md:text-3xl font-bold">Customers</h1>
          </div>
          <p className="text-blue-100">Manage customer accounts and credit terms</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or short code..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-field pl-10 w-full"
            />
          </div>
        </div>

        {/* Add Customer Button */}
        {!showForm && (
          <button
            onClick={() => openForm()}
            className="w-full border-2 border-dashed border-blue-300 rounded-lg py-3 text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm"
          >
            <Plus size={18} /> Add New Customer
          </button>
        )}

        {/* Customer Form */}
        {showForm && (
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title !mb-0 flex items-center gap-2">
                <Users size={16} className="text-blue-600" /> {editId ? 'Edit Customer' : 'New Customer'}
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Customer Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="ABC Beverages Ltd"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Short Name</label>
                <input
                  value={shortName}
                  onChange={e => setShortName(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="ABC"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Contact Person</label>
                <input
                  value={contactPerson}
                  onChange={e => setContactPerson(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Phone</label>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="+91 XXXXX XXXXX"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="contact@abc.com"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">GST No</label>
                <input
                  value={gstNo}
                  onChange={e => setGstNo(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="18AABCT0000X1Z0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">PAN No</label>
                <input
                  value={panNo}
                  onChange={e => setPanNo(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="AAACR5055K"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Credit Limit</label>
                <input
                  type="number"
                  value={creditLimit}
                  onChange={e => setCreditLimit(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="100000"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500">Address</label>
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="input-field w-full text-sm"
                placeholder="Street address"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 my-3">
              <div>
                <label className="text-xs text-gray-500">City</label>
                <input
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Mumbai"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">State</label>
                <input
                  value={state}
                  onChange={e => setState(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Maharashtra"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Pincode</label>
                <input
                  value={pincode}
                  onChange={e => setPincode(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="400001"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-500">Default Payment Terms</label>
              <select
                value={defaultTerms}
                onChange={e => setDefaultTerms(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="ADVANCE">Advance</option>
                <option value="COD">Cash on Delivery</option>
                <option value="NET7">Net 7 Days</option>
                <option value="NET15">Net 15 Days</option>
                <option value="NET30">Net 30 Days</option>
              </select>
            </div>

            <button
              onClick={saveCustomer}
              disabled={saving}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editId ? 'Update Customer' : 'Create Customer'}
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            Loading customers...
          </div>
        )}

        {/* Customer Cards */}
        {!loading && filteredCustomers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredCustomers.map(customer => (
              <div
                key={customer.id}
                className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Card Header - Collapsed View */}
                <button
                  onClick={() => setExpandedId(expandedId === customer.id ? null : customer.id)}
                  className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-bold text-sm md:text-base text-gray-900">{customer.name}</h3>
                      {customer.shortName && (
                        <p className="text-xs text-gray-500 mt-0.5">{customer.shortName}</p>
                      )}
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-gray-400 transition-transform ${expandedId === customer.id ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 items-center text-xs text-gray-600">
                    {customer.city && customer.state && (
                      <span>{customer.city}, {customer.state}</span>
                    )}
                    {customer.phone && <span>{customer.phone}</span>}
                  </div>
                </button>

                {/* Card Body - Expanded View */}
                {expandedId === customer.id && (
                  <div className="px-4 pb-4 border-t pt-3 bg-gray-50">
                    <div className="space-y-2 text-sm mb-3">
                      {customer.address && (
                        <div>
                          <p className="text-xs text-gray-500">Address</p>
                          <p className="text-gray-700">{customer.address}</p>
                        </div>
                      )}
                      {customer.contactPerson && (
                        <div>
                          <p className="text-xs text-gray-500">Contact Person</p>
                          <p className="text-gray-700">{customer.contactPerson}</p>
                        </div>
                      )}
                      {customer.email && (
                        <div>
                          <p className="text-xs text-gray-500">Email</p>
                          <p className="text-gray-700">{customer.email}</p>
                        </div>
                      )}
                      {customer.gstNo && (
                        <div>
                          <p className="text-xs text-gray-500">GST No</p>
                          <p className="text-gray-700 font-mono text-xs">{customer.gstNo}</p>
                        </div>
                      )}
                      {customer.creditLimit && (
                        <div>
                          <p className="text-xs text-gray-500">Credit Limit</p>
                          <p className="text-gray-700 font-semibold">₹{(customer.creditLimit).toLocaleString()}</p>
                        </div>
                      )}
                      {customer.defaultTerms && (
                        <div>
                          <p className="text-xs text-gray-500">Default Terms</p>
                          <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium mt-1">
                            {customer.defaultTerms}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-3 border-t">
                      <button
                        onClick={() => openForm(customer)}
                        className="flex-1 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteCustomer(customer.id)}
                        className="flex-1 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredCustomers.length === 0 && customers.length === 0 && (
          <div className="text-center py-12">
            <Users size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No customers yet. Create your first customer to get started.</p>
          </div>
        )}

        {!loading && filteredCustomers.length === 0 && customers.length > 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No customers match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
