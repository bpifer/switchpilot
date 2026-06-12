# Deployment Notes

Operational details that matter in production but don't fit the README quick start.

## Network paths the switches need

SwitchPilot is not only a client of your switches - for two features the switches
connect back to the platform. Both paths must be reachable **from the switch
management VLAN**:

| Path | Protocol | Used for |
|---|---|---|
| `PLATFORM_URL/api/firmware/files/<name>` | HTTP (TCP) | Switches download IOS images during upgrade jobs (`copy http://... flash:`) |
| Platform host, port 514 | Syslog (UDP) | Real-time alerts and the Logs page (`logging host <platform>`) |

If either is blocked, the failure mode is quiet: firmware jobs error at the copy
stage, and the Logs page simply stays empty.

## The firmware file endpoint is deliberately unauthenticated

`GET /api/firmware/files/:filename` cannot require a JWT because IOS `copy http:`
has no way to send one. Mitigations in place:

- Filenames are checked against the `firmware_images` table (no path traversal,
  no enumeration of anything not explicitly uploaded).
- The endpoint is rate-limited (10 requests/minute per IP) since images are
  hundreds of MB and repeated fetches could saturate the network interface.

**You should still restrict this path to the switch management network** at the
firewall, Ingress, or reverse-proxy layer. Anyone who can reach the API can
download uploaded images (which may embed your organization's licensed software).

## Docker Compose

The bundled `docker-compose.yml` works as-is: nginx (port 8080) proxies `/api/`
with a 2 GB body limit, and the syslog listener needs UDP 514 published if your
switches log to the host. Set `PLATFORM_URL` to `http://<host>:8080`.

## Kubernetes

The manifests in `deploy/k8s/` route all HTTP through the `web` (nginx) Service.
Two things are NOT covered by an Ingress that terminates at the web service:

1. **Firmware downloads from switches** - switches usually cannot resolve or
   reach a cluster Ingress hostname. Expose the API to the management network
   with a dedicated Service, then set `PLATFORM_URL` to its address:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: switchpilot-mgmt
  annotations:
    # pin the LB to the management network, e.g. for MetalLB:
    metallb.universe.tf/address-pool: mgmt-pool
spec:
  type: LoadBalancer
  loadBalancerSourceRanges:
    - 192.168.10.0/24        # switch management VLAN only
  selector:
    app: switchpilot-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

2. **Syslog (UDP 514)** - either add a UDP port to the same LoadBalancer
   Service (`protocol: UDP, port: 514, targetPort: 514`) or run the API pod
   with `hostNetwork` on a node reachable from the management VLAN. Set
   `SYSLOG_PORT` above 1024 if the pod runs unprivileged.

## High availability

Postgres and Redis in the bundled manifests are single-replica with PVCs - fine
for evaluation, not for production. Use a managed Postgres or an operator
(CloudNativePG, Crunchy) and a Redis with persistence/sentinel. The API itself
is HA-ready: scheduler leader election via Postgres advisory lock, job claiming
via FOR UPDATE SKIP LOCKED.
