# Home Network Documentation

This directory is the entry point for documenting the home network, devices, services, and automation runbooks.

## Quick Start
- `overview.md` - high-level architecture and topology diagram.
- `inventory/inventory.yaml` - primary device inventory (flat YAML list).
- `network/topology.md` - address plan, routing, and network services.
- `runbooks/README.md` - operational and incident runbooks.
- `kube/README.md` - Kubernetes cluster documentation index.

## Structure
- `inventory/` - device and service inventories.
- `network/` - topology, addressing, and network services.
- `runbooks/` - operational and incident workflows.
- `kube/` - Kubernetes cluster documentation.
- `images/` - diagrams and screenshots.

## Conventions
- Keep inventory entries in `inventory/inventory.yaml` and link from docs.
- Include IPs, hostnames, MACs, and serials, but never credentials.
- Runbooks should be action-oriented: prechecks, steps, rollback, and validation.
