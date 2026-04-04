"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Search, Check, ChevronDown } from "lucide-react";

interface Institution {
  id: string;
  name: string;
  district: string;
}

interface InstitutionSelectorProps {
  institutions: Institution[];
  selectedInstitution: string;
  onSelectInstitution: (value: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function InstitutionSelector({
  institutions,
  selectedInstitution,
  onSelectInstitution,
  searchQuery,
  onSearchChange,
  isLoading = false,
  disabled = false,
}: InstitutionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group institutions by district and filter
  const institutionsByDistrict = useMemo(() => {
    const filtered = institutions.filter(
      (inst) =>
        inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.district.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const grouped: Record<string, Institution[]> = {};
    filtered.forEach((inst) => {
      const district = inst.district || "Unknown";
      if (!grouped[district]) {
        grouped[district] = [];
      }
      grouped[district].push(inst);
    });

    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [institutions, searchQuery]);

  // Get selected institution details
  const selectedInst = institutions.find((inst) => inst.id === selectedInstitution);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (institutionId: string) => {
    onSelectInstitution(institutionId);
    setIsOpen(false);
    onSearchChange(""); // Clear search after selection
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <Label htmlFor="institutionSearch">Select Your Institution *</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" aria-hidden="true" />
        <Input
          ref={inputRef}
          id="institutionSearch"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="institution-listbox"
          placeholder={
            selectedInst
              ? `${selectedInst.name} (${selectedInst.district})`
              : isLoading
              ? "Loading institutions..."
              : "Search by institution or district name..."
          }
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={handleInputFocus}
          className="pl-10 pr-10"
          disabled={disabled || isLoading}
          autoComplete="off"
        />
        <ChevronDown
          className={`absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />

        {/* Dropdown */}
        {isOpen && !disabled && (
          <div
            id="institution-listbox"
            role="listbox"
            className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-[300px] overflow-y-auto"
          >
            {institutionsByDistrict.length > 0 ? (
              institutionsByDistrict.map(([district, insts]) => (
                <div key={district} role="group" aria-label={district}>
                  <div className="px-3 py-2 text-sm font-semibold text-gray-500 bg-gray-50 sticky top-0" aria-hidden="true">
                    {district}
                  </div>
                  {insts.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      role="option"
                      aria-selected={selectedInstitution === inst.id}
                      onClick={() => handleSelect(inst.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-100 flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selectedInstitution === inst.id ? "bg-blue-50" : ""
                      }`}
                    >
                      <span className="text-sm">{inst.name}</span>
                      {selectedInstitution === inst.id && (
                        <Check className="h-4 w-4 text-blue-600" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-sm text-center text-gray-500">
                {isLoading ? "Loading..." : "No institutions found"}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedInst && (
        <p className="text-xs text-gray-500">
          Selected: <span className="font-medium">{selectedInst.name}</span> •{" "}
          <span className="text-gray-400">{selectedInst.district}</span>
        </p>
      )}
    </div>
  );
}
