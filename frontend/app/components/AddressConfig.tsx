"use client";

import { useState, useEffect } from "react";
import { getAddresses, setAddresses } from "@/lib/addresses";
import type { DeployedAddresses } from "@/lib/contracts";

export function AddressConfig({ onUpdate }: { onUpdate: (addr: DeployedAddresses) => void }) {
  const [json, setJson] = useState("");
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);

  // Auto-load from localStorage or API on mount
  useEffect(() => {
    const addr = getAddresses();
    if (addr.nofeeswap !== "0x0000000000000000000000000000000000000000") {
      setLoaded(true);
      onUpdate(addr);
      return;
    }

    // Try auto-loading from the API
    setAutoLoading(true);
    fetch("/api/addresses")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.nofeeswap) {
          setAddresses(data);
          onUpdate(data);
          setLoaded(true);
        }
      })
      .catch(() => {})
      .finally(() => setAutoLoading(false));
  }, [onUpdate]);

  const handleLoad = () => {
    try {
      const parsed = JSON.parse(json);
      setAddresses(parsed);
      onUpdate(parsed);
      setLoaded(true);
      setShow(false);
    } catch {
      alert("Invalid JSON. Paste the contents of deployed-addresses.json");
    }
  };

  const handleAutoLoad = async () => {
    try {
      setAutoLoading(true);
      const resp = await fetch("/api/addresses");
      const data = await resp.json();
      if (data && data.nofeeswap) {
        setAddresses(data);
        onUpdate(data);
        setLoaded(true);
        setShow(false);
      } else {
        alert("No addresses found. Run the deploy script first.");
      }
    } catch {
      alert("Could not load addresses. Make sure the deploy script has been run.");
    } finally {
      setAutoLoading(false);
    }
  };

  if (loaded && !show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="text-xs text-gray-500 hover:text-gray-300"
      >
        Contract Addresses Loaded
      </button>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-2">Load Contract Addresses</h3>

      {/* Auto-load button */}
      <button
        onClick={handleAutoLoad}
        disabled={autoLoading}
        className="w-full mb-3 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium transition"
      >
        {autoLoading ? "Loading..." : "Auto-Load from deployed-addresses.json"}
      </button>

      <div className="text-center text-xs text-gray-500 mb-3">or paste manually:</div>

      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        className="w-full h-24 bg-gray-800 border border-gray-600 rounded p-2 text-xs font-mono text-gray-300 mb-2"
        placeholder='{"nofeeswap": "0x...", "operator": "0x...", ...}'
      />
      <div className="flex gap-2">
        <button
          onClick={handleLoad}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
        >
          Load Addresses
        </button>
        {loaded && (
          <button
            onClick={() => setShow(false)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
