# Network Topology

This document captures addressing, routing, and network services. It reflects the current single-site LAN setup and should evolve as segmentation or services are added.

## Address Plan
- Primary LAN: `192.168.0.0/24` (based on current host inventory).
- Gateway/Router: OpenWrt (Netgear Nighthawk AC2400) at `192.168.0.1`.
- DHCP range: TBD.
- Static/reserved IPs: Kubernetes nodes, NAS, Umbrel, and printers.

## Core Services
- DNS: OpenWrt (TBD confirm upstream resolver).
- DHCP: OpenWrt.
- NTP: TBD.
- Reverse proxy / ingress: see `../kube/MEDIA_STACK.md`.

## Known Static IPs
- `192.168.0.84` - bletchley001 (kube-control-plane)
- `192.168.0.83` - bletchley002 (kube-worker)
- `192.168.0.82` - bletchley003 (kube-worker)
- `192.168.0.81` - bletchley004 (kube-worker)
- `192.168.0.80` - bletchley005 (kube-worker)
- `192.168.0.43` - lynott (Synology NAS)
- `192.168.0.26` - umbrel (Bitcoin/Lightning node)
- `192.168.0.214` - octopi (3D printer)
- `192.168.0.163` - octopi-mini (3D printer)
- `192.168.0.150` - Bambu Lab P2S

## Routing and Firewall
- Routing: single flat LAN (no VLANs yet).
- Firewall rules: TBD (router defaults unless documented).

## References
- Device inventory: `../inventory/inventory.yaml`.
- Kubernetes docs: `../kube/README.md`.
