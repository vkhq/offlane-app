// SPDX-License-Identifier: GPL-3.0-or-later
//
// The public keys that may sign the toolkit feed (see ./feed.ts). A feed is
// trusted when any one of them verifies its signature.
//
// It's a list so the signing key can be rotated without stranding installed
// copies: ship the new key here beside the old one, start signing with the
// new key, then drop the old one in a later release. If a private key leaks,
// sign with another listed key and remove the leaked one in the next release.
//
// Public keys only. The private keys never enter this repository: they sit
// in the publisher's offline storage and in the offlane-toolkits release
// Environment (FEED_SIGNING_KEY). Make one with `openssl genpkey -algorithm
// ed25519` and add its `openssl pkey -pubout` output here.
//
// No Electron import.

export const feedPublicKeys: readonly string[] = [
  // Primary, created 2026-11-18.
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAJM5LQqLQxx/RSHLwiEQiLC8USJXwoRkWnaQ+aXS8gE=
-----END PUBLIC KEY-----`,
  // Spare, created 2026-11-18. Kept offline only; signs nothing until the
  // primary is retired or leaks.
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADFvODJmnuDyUSL3OEwmvStshkKXwaQ47WkpAHuJ73q0=
-----END PUBLIC KEY-----`,
];
