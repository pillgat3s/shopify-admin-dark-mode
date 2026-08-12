# Privacy Policy — Shopify Admin Dark Mode

**Effective date:** August 12, 2026

Shopify Admin Dark Mode is a browser extension that applies a dark colour
theme to the Shopify admin and the Shopify Partners dashboard.

## Data collection

The extension does **not** collect, store, or transmit any personal data.

- **No analytics or tracking.** There is no telemetry of any kind.
- **No external servers.** The extension never makes a network request. All
  code ships inside the extension package.
- **No page data is read or stored.** The extension only applies styling to
  the pages listed in its permissions. It does not read, record, or transmit
  the content of any page.
- **No accounts.** There is nothing to sign up for or log in to.

## What is stored

A single on/off preference (whether dark mode is enabled) is saved locally
in your browser using the `chrome.storage` API. This value never leaves your
device and is deleted when the extension is uninstalled.

## Permissions

The extension requests access only to `admin.shopify.com`,
`partners.shopify.com`, and the domains of embedded Shopify admin apps, so
its content script can apply the theme there. See the
[README](README.md) for the full list and reasoning.

## Changes

Any change to this policy will be published in this repository. Given the
extension's design — no data collection at all — changes are unlikely.

## Contact

Questions: open an issue at
<https://github.com/pillgat3s/shopify-admin-dark-mode/issues>.
