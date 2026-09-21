import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const pack = readFileSync(join(here, "pack-crx.sh"), "utf8");
const checkout = readFileSync(join(here, "checkout-crx-key.sh"), "utf8");
test("pack-crx.sh shreds the exact Chrome UI PEM after a 5 minute sleep", () => {
  assert.match(pack, /CRX_ID="kfgmpcgplemjepolfpdbodmakceacook"/);
  assert.match(pack, /CHROME_PEM="\$HOME\/tkrWallet-chrome-extension-\$\{CRX_ID\}\.pem"/);
  assert.match(pack, /sleep 300/);
  assert.match(pack, /shred -u "\$CHROME_PEM"/);
});

test("checkout-crx-key.sh shreds the checkout and Chrome UI PEM after 5 minutes", () => {
  assert.match(checkout, /CRX_ID="kfgmpcgplemjepolfpdbodmakceacook"/);
  assert.match(checkout, /CHROME_PEM="\$HOME\/tkrWallet-chrome-extension-\$\{CRX_ID\}\.pem"/);
  assert.match(checkout, /sleep 300/);
  assert.match(checkout, /shred -u "\$OUTFILE"/);
  assert.match(checkout, /shred -u "\$CHROME_PEM"/);
});
