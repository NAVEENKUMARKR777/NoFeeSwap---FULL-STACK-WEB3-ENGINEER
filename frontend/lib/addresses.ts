import type { DeployedAddresses } from "./contracts";
import { DEFAULT_ADDRESSES } from "./contracts";

// Try to load deployed addresses from the generated file
let deployedAddresses: DeployedAddresses = DEFAULT_ADDRESSES;

try {
  // In production, these would be loaded from environment or a config endpoint
  // For local dev, we read from the deployed-addresses.json created by deploy script
  const stored =
    typeof window !== "undefined"
      ? localStorage.getItem("nofeeswap-addresses")
      : null;
  if (stored) {
    deployedAddresses = JSON.parse(stored);
  }
} catch {
  // Use defaults
}

export function getAddresses(): DeployedAddresses {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("nofeeswap-addresses");
    if (stored) {
      return JSON.parse(stored);
    }
  }
  return DEFAULT_ADDRESSES;
}

export function setAddresses(addresses: DeployedAddresses) {
  if (typeof window !== "undefined") {
    localStorage.setItem("nofeeswap-addresses", JSON.stringify(addresses));
  }
}
