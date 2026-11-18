# Contributing

Thanks for your interest in Offlane.

Outside contributions will require signing the Offlane Contributor License Agreement. Until it is published, external pull requests are welcome for discussion but will not be merged.

- Individuals: [CLA.md](CLA.md)
- Contributors whose employer owns their work: [CLA-corporate.md](CLA-corporate.md)

Offlane is licensed under the [GNU General Public License v3.0 or later](LICENSE). Offlane stays available under the GPL-3.0-or-later whatever else is added.

## Before you open a pull request

- `npm install` also turns on a pre-commit check that stops commits containing secrets. It needs [gitleaks](https://github.com/gitleaks/gitleaks#installing).
- Run `npm run typecheck`, `npm run lint` and `npm run test:integration`, and make sure they pass.
- Start new source files with `// SPDX-License-Identifier: GPL-3.0-or-later`.
- Don't add toolkit binaries, models or signing keys. Toolkits are built and published from [offlane-toolkits](https://github.com/vkhq/offlane-toolkits).
