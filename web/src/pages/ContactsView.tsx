import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  UserPlus,
  Upload,
  Phone,
  MessageSquare,
  Edit2,
  Trash2,
  X,
  FileText,
  Check,
  Smartphone,
  RefreshCw,
} from "lucide-react";

export interface ContactItem {
  id: string;
  phone: string;
  displayName: string;
  notes: string | null;
  avatarColor: string;
  preferredSim: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ContactsViewProps {
  onStartChat: (phone: string) => void;
  simLabels?: Record<number, { label: string; color: string }>;
}

export const ContactsView: React.FC<ContactsViewProps> = ({
  onStartChat,
}) => {
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formColor, setFormColor] = useState("#5B5CE6");

  // Phone Contacts Import State
  const [isImportingPhone, setIsImportingPhone] = useState(false);
  const [phoneImportMsg, setPhoneImportMsg] = useState<string | null>(null);

  // VCF Import Modal
  const [isVcfModalOpen, setIsVcfModalOpen] = useState(false);
  const [vcfFile, setVcfFile] = useState<File | null>(null);
  const [vcfText, setVcfText] = useState("");
  const [vcfResult, setVcfResult] = useState<{ imported: number; total: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const vcfInputRef = useRef<HTMLInputElement>(null);

  const fetchContacts = async () => {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const openAddModal = () => {
    setEditingContact(null);
    setFormName("");
    setFormPhone("");
    setFormNotes("");
    setFormColor("#5B5CE6");
    setIsModalOpen(true);
  };

  const openEditModal = (c: ContactItem) => {
    setEditingContact(c);
    setFormName(c.displayName);
    setFormPhone(c.phone);
    setFormNotes(c.notes || "");
    setFormColor(c.avatarColor || "#5B5CE6");
    setIsModalOpen(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) return;

    const payload = {
      displayName: formName.trim(),
      phone: formPhone.trim(),
      notes: formNotes.trim() || undefined,
      avatarColor: formColor,
    };

    if (editingContact) {
      const res = await fetch(`/api/contacts/${editingContact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchContacts();
      }
    } else {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchContacts();
      }
    }
  };

  const handleImportFromPhone = async () => {
    setIsImportingPhone(true);
    setPhoneImportMsg(null);
    try {
      const res = await fetch("/api/contacts/import-phone", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Phone contact import failed");
      setPhoneImportMsg(`Imported ${data.importedCount} contacts from phone! (${data.skippedCount} already existed)`);
      fetchContacts();
      setTimeout(() => setPhoneImportMsg(null), 5000);
    } catch (err: any) {
      alert(`Could not import contacts from phone: ${err.message}`);
    } finally {
      setIsImportingPhone(false);
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchContacts();
    }
  };

  // VCF Handler
  const handleVcfUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vcfFile && !vcfText) return;

    setIsImporting(true);
    try {
      const res = await fetch("/api/contacts/import-vcf", {
        method: "POST",
        headers: { "Content-Type": "text/vcard" },
        body: vcfFile ? await vcfFile.text() : vcfText,
      });

      if (res.ok) {
        const data = await res.json();
        setVcfResult({ imported: data.importedCount, total: data.totalCards });
        fetchContacts();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsImporting(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.displayName.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.notes || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full w-full bg-canvas overflow-hidden">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between p-4 md:px-6 bg-sidebar border-b border-border-subtle gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Contacts</h2>
          <p className="text-xs text-text-secondary">
            {contacts.length} encrypted contact{contacts.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
            />
          </div>

          <button
            onClick={handleImportFromPhone}
            disabled={isImportingPhone}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-app hover:bg-canvas border border-border-subtle text-text-primary text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            title="Import Contacts from Host Phone"
          >
            {isImportingPhone ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent-primary" />
            ) : (
              <Smartphone className="w-3.5 h-3.5 text-accent-primary" />
            )}
            <span className="hidden sm:inline">{isImportingPhone ? "Importing..." : "Sync from Phone"}</span>
          </button>

          <button
            onClick={() => {
              setVcfResult(null);
              setVcfFile(null);
              setVcfText("");
              setIsVcfModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-app hover:bg-canvas border border-border-subtle text-text-primary text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
            title="Import vCard (.vcf)"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Import .vcf</span>
          </button>

          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
      </header>

      {/* Sync Status Banner */}
      {phoneImportMsg && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-between">
          <span>{phoneImportMsg}</span>
          <button onClick={() => setPhoneImportMsg(null)} className="p-0.5 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Contact Cards Grid / List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="p-8 text-center text-xs text-text-muted">Loading contacts...</div>
        ) : filteredContacts.length === 0 ? (
          <div className="p-12 text-center text-xs text-text-muted">
            {searchQuery ? "No matching contacts" : "No contacts yet. Add or import your first contact!"}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex flex-col justify-between p-4 rounded-2xl bg-sidebar border border-border-subtle shadow-card hover:border-accent-primary/30 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-full font-bold text-white text-base shadow-sm shrink-0"
                    style={{ backgroundColor: contact.avatarColor }}
                  >
                    {contact.displayName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-text-primary truncate">
                      {contact.displayName}
                    </h4>
                    <p className="text-xs font-mono text-text-muted mt-0.5">{contact.phone}</p>
                    {contact.notes && (
                      <p className="text-[11px] text-text-secondary mt-1 truncate">
                        {contact.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-subtle">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onStartChat(contact.phone)}
                      className="p-2 rounded-xl bg-app hover:bg-accent-soft text-text-secondary hover:text-accent-primary transition-colors"
                      title="Send Message"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <a
                      href={`tel:${contact.phone}`}
                      className="p-2 rounded-xl bg-app hover:bg-accent-soft text-text-secondary hover:text-accent-primary transition-colors"
                      title="Call"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(contact)}
                      className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-app transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(contact.id)}
                      className="p-2 rounded-xl text-text-muted hover:text-rose-500 hover:bg-app transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Contact Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border-subtle shadow-card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
              <h3 className="text-sm font-bold text-text-primary">
                {editingContact ? "Edit Contact" : "Add New Contact"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-app"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContact} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Full Display Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Alice Smith"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Phone Number (E.164)
                </label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="+1 (334) 555-0199"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary font-mono focus:outline-accent-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Notes (Encrypted)
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional notes or details..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-app border border-border-subtle text-text-primary focus:outline-accent-primary resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-text-secondary hover:bg-app"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs cursor-pointer"
                >
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk vCard Importer Modal */}
      {isVcfModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-sidebar border border-border-subtle shadow-card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
              <h3 className="text-sm font-bold text-text-primary">Bulk Import vCard (.vcf)</h3>
              <button
                onClick={() => setIsVcfModalOpen(false)}
                className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-app"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {vcfResult ? (
              <div className="text-center py-6 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-text-primary">Import Complete</h4>
                <p className="text-xs text-text-secondary">
                  Successfully imported <span className="font-bold text-text-primary">{vcfResult.imported}</span> contact(s) out of {vcfResult.total} found.
                </p>
                <button
                  onClick={() => setIsVcfModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleVcfUpload} className="space-y-4">
                <div
                  onClick={() => vcfInputRef.current?.click()}
                  className="p-6 border-2 border-dashed border-border-subtle hover:border-accent-primary rounded-xl bg-app text-center cursor-pointer transition-colors"
                >
                  <FileText className="w-8 h-8 text-accent-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-text-primary">
                    {vcfFile ? vcfFile.name : "Click to select or drag & drop .vcf file"}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Exported from Google Contacts, iOS, or Android
                  </p>
                  <input
                    type="file"
                    ref={vcfInputRef}
                    accept=".vcf,text/vcard"
                    onChange={(e) => setVcfFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                  <button
                    type="button"
                    onClick={() => setIsVcfModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-text-secondary hover:bg-app"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!vcfFile && !vcfText}
                    className="px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isImporting ? "Importing..." : "Upload & Import"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
