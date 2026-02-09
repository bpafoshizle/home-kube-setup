# Home Network Overview

This overview captures the current single-site network layout and the major device roles. Update this document as additional segments, VLANs, or services come online.

## Topology (Current)
```mermaid
flowchart LR
  Internet((Internet)) --> Router[OpenWrt Router\nNetgear Nighthawk AC2400]
  Router --> LAN[LAN 192.168.0.0/24]

  subgraph Kubernetes Cluster
    CP[bletchley001\ncontrol plane]
    W1[bletchley002\nworker]
    W2[bletchley003\nworker]
    W3[bletchley004\nworker]
    W4[bletchley005\nworker]
  end

  LAN --> CP
  LAN --> W1
  LAN --> W2
  LAN --> W3
  LAN --> W4
  LAN --> NAS[lynott\nSynology NAS]
  LAN --> Umbrel[umbrel\nBitcoin node]
  LAN --> Octo[octopi\n3D printer]
  LAN --> OctoMini[octopi-mini\n3D printer]
  LAN --> Bambu[Bambu Lab P2S\n3D printer]
  LAN --> Clients[User clients\nWindows PC, Mac, mobile]
  LAN --> IoT[IoT + printers\nRaspberry Pi(s)]
```

## Notes
- Current network appears to be a single flat LAN (based on `192.168.0.x` hosts).
- Use `inventory/inventory.yaml` as the authoritative device list.
- Add subnets/VLANs here if/when they are introduced.
