# Deploying the tkrWallet edge

The wallet's counterparty is the icehut edge. `nginx/tkrwallet-edge.conf.template`
is the hardened vhost for `https://tkrwallet.scratchpost.ai`, carrying every fix
from `docs/security/security-audit.md` (R-1…R-12).

## Prerequisites (on icehut)

1. Cloudflare proxied for `tkrwallet.scratchpost.ai`, with **Authenticated
   Origin Pulls** enabled — the vhost rejects any peer that is not Cloudflare.
2. `{{CLOUDFLARE_RANGES}}` from <https://www.cloudflare.com/ips/>.
3. An origin certificate for the host, and the Cloudflare origin-pull CA file.
4. The wallet facade listening on `{{FACADE_UPSTREAM}}` (see
   `docs/specs/icehut-edge.md` — auth, prices, rate limits).
5. The wallet static files at `{{WALLET_ROOT}}` (this repository's web root).

## Install

```bash
sed -e 's|{{SSL_FULLCHAIN}}|/etc/nginx/certs/wallet.fullchain.pem|' \
    -e 's|{{SSL_PRIVKEY}}|/etc/nginx/certs/wallet.key|' \
    -e 's|{{CF_ORIGIN_PULL_CA}}|/etc/nginx/certs/cf-origin-pull-ca.pem|' \
    -e 's|{{FACADE_UPSTREAM}}|http://127.0.0.1:8089|' \
    -e 's|{{WALLET_ROOT}}|/srv/tkrwallet|' \
    nginx/tkrwallet-edge.conf.template \
    > /etc/nginx/sites-available/tkrwallet-edge

ln -sfn /etc/nginx/sites-available/tkrwallet-edge /etc/nginx/sites-enabled/tkrwallet-edge
nginx -t && systemctl reload nginx
```

## Verify

```bash
# headers on the static shell
curl -sI https://tkrwallet.scratchpost.ai/ | grep -iE 'strict-transport|content-security|x-content'
# preflight for the extension origin (handled by the facade)
curl -s -X OPTIONS https://tkrwallet.scratchpost.ai/api/wallet/session \
  -H "Origin: chrome-extension://hkljagpgkenlmfemcddcnhoaddpndldn" \
  -H "Access-Control-Request-Method: POST" -o /dev/null -w '%{http_code}\n'
# healthz without auth
curl -s https://tkrwallet.scratchpost.ai/healthz
```

## Do not do

- Do not add an RPC passthrough location. No endpoint here may reach a node.
- Do not loosen `connect-src 'self'` — that line is what makes
  "never talks to eva" enforceable in the browser.
- Do not restore `$proxy_add_x_forwarded_for`. The single authoritative
  `X-Forwarded-For: $remote_addr` is deliberate (audit R-4).
